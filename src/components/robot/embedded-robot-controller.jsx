import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

const ROBOT_STATUS_EVENT = 'ROBOT_CONNECTION_STATUS';
const DEFAULT_EYE_SHAPE = 'Eyeball';
const FILE_BASE = 'static/robot-files';

const HEADNOD = 0;
const HEADTURN = 1;
const EYETURN = 2;
const LIDBLINK = 3;
const TOPLIP = 4;
const BOTTOMLIP = 5;
const EYETILT = 6;

const createInitialState = () => ({
    motorPos: [11, 11, 11, 11, 11, 11, 11, 11],
    motorMins: [0, 0, 0, 0, 0, 0, 0, 0],
    motorMaxs: [0, 0, 0, 0, 0, 0, 0, 0],
    motorRev: [false, false, false, false, false, false, false, false],
    restPos: [0, 0, 0, 0, 0, 0, 0, 0],
    isAttached: [false, false, false, false, false, false, false, false],
    lastMoved: [0, 0, 0, 0, 0, 0, 0, 0],
    lastScaledPosition: [-1, -1, -1, -1, -1, -1, -1, -1],
    motorType: ['', '', '', '', '', '', '', ''],
    motorNames: ['', '', '', '', '', '', '', ''],
    motorSpeeds: [120, 40, 120, 120, 120, 120, 120, 120],
    motorSpeedOverrides: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN],
    shapeList: [],
    robot: 'none',
    connected: false,
    isConnecting: false,
    motorDefsLoaded: false,
    readBuffer: '',
    ledR: 0,
    ledG: 0,
    ledB: 0,
    lastfex: 5,
    lastfey: 5,
    lastWriteTime: 0
});

class EmbeddedRobotController extends React.Component {
    constructor (props) {
        super(props);
        this.controllerState = createInitialState();
        this.serialPort = null;
        this.outputStream = null;
        this.inputStream = null;
        this.reader = null;
        this.writer = null;
        this.encoderClosed = null;
        this.decoderClosed = null;
        this.keepAliveInterval = null;

        this.handleCommand = this.handleCommand.bind(this);
        this.handleToggleConnection = this.handleToggleConnection.bind(this);
        this.handleReset = this.handleReset.bind(this);
    }

    componentDidMount () {
        const runtime = this.props.vm.runtime;
        runtime.on('ROBOT_COMMAND', this.handleCommand);
        runtime.on('ROBOT_TOGGLE_CONNECTION', this.handleToggleConnection);
        runtime.on('ROBOT_RESET', this.handleReset);
        this.emitStatus();
        this.keepAliveInterval = window.setInterval(() => this.tick(), 1000);
    }

    componentWillUnmount () {
        const runtime = this.props.vm.runtime;
        runtime.removeListener('ROBOT_COMMAND', this.handleCommand);
        runtime.removeListener('ROBOT_TOGGLE_CONNECTION', this.handleToggleConnection);
        runtime.removeListener('ROBOT_RESET', this.handleReset);
        if (this.keepAliveInterval) {
            window.clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        this.disconnect();
    }

    emitStatus () {
        this.props.vm.runtime.emit(ROBOT_STATUS_EVENT, {
            connected: this.controllerState.connected,
            isConnecting: this.controllerState.isConnecting,
            robot: this.controllerState.robot,
            isAttached: this.controllerState.isAttached.slice(),
            motorNames: this.controllerState.motorNames.slice(),
            motorType: this.controllerState.motorType.slice(),
            shapeCount: this.controllerState.shapeList.length
        });
    }

    updateStatus (nextValues) {
        Object.assign(this.controllerState, nextValues);
        this.emitStatus();
    }

    writeToStream (line) {
        if (!this.writer || !this.outputStream) return;
        this.writer.write(`${line}\n`);
        this.controllerState.lastWriteTime = Date.now();
    }

    limit (num) {
        return Math.max(0, Math.min(10, num));
    }

    indexFromMotor (name) {
        switch ((name || '').toLowerCase()) {
        case 'headnod': return HEADNOD;
        case 'headturn': return HEADTURN;
        case 'eyeturn': return EYETURN;
        case 'lidblink': return LIDBLINK;
        case 'toplip': return TOPLIP;
        case 'bottomlip': return BOTTOMLIP;
        case 'eyetilt': return EYETILT;
        case 'headroll': return 7;
        default: return 0;
        }
    }

    getPos (motorIndex, pos) {
        const motorRange =
            this.controllerState.motorMaxs[motorIndex] -
            this.controllerState.motorMins[motorIndex];
        const scaledPos = (motorRange / 10) * pos;
        return parseInt((scaledPos + this.controllerState.motorMins[motorIndex]).toString(), 10);
    }

    reverseBits (str) {
        const value = parseInt(str, 16);
        let reversed = 0;
        if (value & 0x80) reversed += 1;
        if (value & 0x40) reversed += 2;
        if (value & 0x20) reversed += 4;
        if (value & 0x10) reversed += 8;
        if (value & 0x08) reversed += 16;
        if (value & 0x04) reversed += 32;
        if (value & 0x02) reversed += 64;
        if (value & 0x01) reversed += 128;
        return (`00${reversed.toString(16)}`).substr(-2, 2);
    }

    eyeShapeBytes (definitionR, definition, setNo, autoMirror) {
        let output = '';
        for (let x = 0; x < 9; x++) {
            if (output.length > 0) {
                output += ',';
            }
            const offset = (setNo * 18) + (x * 2);
            output += autoMirror ?
                definition.substring(offset, offset + 2) :
                this.reverseBits(definition.substring(offset, offset + 2));
            output += this.reverseBits(definitionR.substring(offset, offset + 2));
        }
        return output;
    }

    listParse (bits, fallbackValue, prefix) {
        for (let i = 0; i < bits.length; i++) {
            const bit = bits[i];
            if (bit.indexOf(`${prefix}:`) === 0) {
                const split = bit.split(':');
                if (split.length > 1) {
                    const parsed = parseInt(split[1], 10);
                    if (!isNaN(parsed)) {
                        return parsed;
                    }
                }
            }
        }
        return fallbackValue;
    }

    async readLineWithTimeout (timeoutMs) {
        if (!this.reader) return '';

        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const result = await this.reader.read();
            if (result.done) {
                return '';
            }
            if (result.value) {
                this.controllerState.readBuffer += result.value;
            }
            const newlineIndex = this.controllerState.readBuffer.indexOf('\n');
            if (newlineIndex !== -1) {
                const line = this.controllerState.readBuffer.slice(0, newlineIndex).trim();
                this.controllerState.readBuffer =
                    this.controllerState.readBuffer.slice(newlineIndex + 1);
                return line;
            }
        }

        return '';
    }

    detach (index) {
        this.writeToStream(`d0${index}`);
        this.controllerState.isAttached[index] = false;
        this.emitStatus();
    }

    setSpeedOverride (index, value, resetting) {
        this.controllerState.motorSpeedOverrides[index] = resetting ? NaN : value;
    }

    updateLed () {
        const r = parseInt((this.controllerState.ledR * 25.5).toString(), 10);
        const g = parseInt((this.controllerState.ledG * 25.5).toString(), 10);
        const b = parseInt((this.controllerState.ledB * 25.5).toString(), 10);
        this.writeToStream(`l00,${r.toString()},${g.toString()},${b.toString()}`);
        this.writeToStream(`l01,${r.toString()},${g.toString()},${b.toString()}`);
    }

    setColour (colour, value) {
        if (colour === 'red' && this.controllerState.ledR === value) return;
        if (colour === 'green' && this.controllerState.ledG === value) return;
        if (colour === 'blue' && this.controllerState.ledB === value) return;

        if (colour === 'red') this.controllerState.ledR = value;
        if (colour === 'green') this.controllerState.ledG = value;
        if (colour === 'blue') this.controllerState.ledB = value;
        this.updateLed();
    }

    colourFromName (name) {
        switch ((name || '').toLowerCase()) {
        case 'red': return [10, 0, 0];
        case 'green': return [0, 10, 0];
        case 'blue': return [0, 0, 10];
        case 'yellow': return [10, 10, 0];
        case 'orange': return [10, 6.5, 0];
        case 'purple': return [10, 0, 10];
        case 'white': return [10, 10, 10];
        default: return [0, 0, 0];
        }
    }

    buildPositionCommand (index, position, resetting) {
        if (!this.controllerState.motorDefsLoaded) return null;

        let nextPosition = this.limit(position);
        if (this.controllerState.motorPos[index] === nextPosition && !resetting) {
            return null;
        }

        this.controllerState.motorPos[index] = nextPosition;

        if (this.controllerState.robot === 'ohbot') {
            if (index === TOPLIP) {
                const flippedPos = 10 - nextPosition;
                if (flippedPos > this.controllerState.motorPos[BOTTOMLIP]) {
                    nextPosition = 10 - this.controllerState.motorPos[BOTTOMLIP];
                }
            }
            if (index === BOTTOMLIP) {
                const flippedPos = 10 - nextPosition;
                if (flippedPos > this.controllerState.motorPos[TOPLIP]) {
                    nextPosition = 10 - this.controllerState.motorPos[TOPLIP];
                }
            }
        }

        if (this.controllerState.robot === 'picoh' && nextPosition < 5 && index === BOTTOMLIP) {
            nextPosition = 5 - ((5 - nextPosition) / 2);
        }

        if (this.controllerState.motorRev[index]) {
            nextPosition = 10 - nextPosition;
        }

        const motorType = this.controllerState.motorType[index];
        if (motorType === 'Matrix X') {
            nextPosition = ((nextPosition - 5) * 0.4) + 5;
            this.controllerState.lastfex = nextPosition;
            return `FE,0,${
                Math.round((nextPosition * 255) / 10)
            },${
                Math.round((this.controllerState.lastfey * 255) / 10)
            }`;
        }

        if (motorType === 'Matrix Y') {
            nextPosition = ((nextPosition - 5) * 0.4) + 5;
            this.controllerState.lastfey = nextPosition;
            return `FE,0,${
                Math.round((this.controllerState.lastfex * 255) / 10)
            },${
                Math.round((nextPosition * 255) / 10)
            }`;
        }

        if (motorType === 'Matrix Lid') {
            return `FL,+0,${Math.round(((10 - nextPosition) * 255) / 10)}`;
        }

        const commands = [];
        if (!this.controllerState.isAttached[index]) {
            commands.push(`a0${index}`);
            this.controllerState.isAttached[index] = true;
            this.emitStatus();
        }

        const scaledPosition = this.getPos(index, nextPosition);
        if (this.controllerState.lastScaledPosition[index] !== scaledPosition) {
            let speed = this.controllerState.motorSpeeds[index];
            if (!isNaN(this.controllerState.motorSpeedOverrides[index])) {
                speed = this.controllerState.motorSpeedOverrides[index] * 250 / 10;
            }
            commands.push(`m0${index},${scaledPosition},${speed}`);
            this.controllerState.lastMoved[index] = Date.now();
            this.controllerState.lastScaledPosition[index] = scaledPosition;
        }

        return commands.length ? commands.join('\n') : null;
    }

    setPosition (index, position, resetting) {
        const command = this.buildPositionCommand(index, position, resetting);
        if (command) {
            this.writeToStream(command);
        }
    }

    setEyes (leftDefinition, rightDefinition, autoMirror) {
        const right = rightDefinition || leftDefinition;
        this.writeToStream(`FB,0,${this.eyeShapeBytes(leftDefinition, right, 0, autoMirror)}`);
        this.writeToStream(`FB,1,${this.eyeShapeBytes(leftDefinition, right, 1, autoMirror)}`);
        this.writeToStream(`FB,2,${this.eyeShapeBytes(leftDefinition, right, 2, autoMirror)}`);
        this.writeToStream(`FB,3,${this.eyeShapeBytes(leftDefinition, right, 3, autoMirror)}`);
        this.writeToStream(`FB,4,${this.eyeShapeBytes(leftDefinition, right, 4, autoMirror)}`);
        this.writeToStream(`FB,8,${this.eyeShapeBytes(leftDefinition, right, 5, autoMirror)}`);
    }

    setEyeShape (shapeNameRight, shapeNameLeft) {
        const leftName = shapeNameLeft || shapeNameRight;
        let leftHex = '';
        let rightHex = '';
        let selectedShape = null;

        for (let i = 0; i < this.controllerState.shapeList.length; i++) {
            const shape = this.controllerState.shapeList[i];
            if (shape.name.toUpperCase() === shapeNameRight.toUpperCase()) {
                rightHex = shape.hexString;
                selectedShape = shape;
            }
            if (shape.name.toUpperCase() === leftName.toUpperCase()) {
                leftHex = shape.hexString;
            }
        }

        if (!leftHex || !selectedShape) {
            return;
        }

        this.setEyes(rightHex, leftHex, selectedShape.autoMirror);
        this.setPosition(this.indexFromMotor('eyetilt'), this.controllerState.motorPos[EYETILT], false);
        this.setPosition(this.indexFromMotor('eyeturn'), this.controllerState.motorPos[EYETURN], false);
    }

    reset (robotOverride) {
        const robot = robotOverride || this.controllerState.robot;
        this.controllerState.ledR = 0;
        this.controllerState.ledG = 0;
        this.controllerState.ledB = 0;

        if (robot === 'picoh') {
            window.setTimeout(() => this.setEyeShape(DEFAULT_EYE_SHAPE), 10);
        }

        for (let i = 0; i < 8; i++) {
            this.setSpeedOverride(i, 0, true);
            const command = this.buildPositionCommand(i, this.controllerState.restPos[i], true);
            if (command) {
                window.setTimeout(() => this.writeToStream(command), 20 + (i * 10));
            }
        }

        window.setTimeout(() => this.updateLed(), 100);
        window.setTimeout(() => {
            for (let i = 0; i < 7; i++) {
                this.detach(i);
            }
        }, 1000);
    }

    async loadMotorDefinitions (robotType) {
        let fileName = 'MotorDefinitionsv22.omd';
        if (robotType === 'picoh') {
            fileName = 'MotorDefinitionsPicoh.omd';
        }

        const response = await fetch(`${FILE_BASE}/${fileName}`);
        const xmlText = await response.text();
        const xmlDoc = (new DOMParser()).parseFromString(xmlText, 'text/xml');
        const motors = xmlDoc.getElementsByTagName('Motor');

        for (let i = 0; i < motors.length; i++) {
            const motor = motors[i];
            const index = parseInt(motor.getAttribute('Motor'), 10);
            this.controllerState.motorMins[index] = parseInt(
                ((parseInt(motor.getAttribute('Min'), 10) / 1000) * 180).toString(),
                10
            );
            this.controllerState.motorMaxs[index] = parseInt(
                ((parseInt(motor.getAttribute('Max'), 10) / 1000) * 180).toString(),
                10
            );
            this.controllerState.restPos[index] = parseInt(motor.getAttribute('RestPosition'), 10);
            this.controllerState.motorPos[index] = this.controllerState.restPos[index];
            this.controllerState.motorRev[index] = motor.getAttribute('Reverse') === 'True';
            this.controllerState.motorType[index] = motor.getAttribute('MotorType') || '';
            this.controllerState.motorNames[index] = motor.getAttribute('Name') || `Motor ${index}`;
            const speed = parseInt(motor.getAttribute('Speed'), 10);
            if (!isNaN(speed)) {
                this.controllerState.motorSpeeds[index] = speed;
            }
        }

        this.controllerState.motorDefsLoaded = true;
        this.emitStatus();
    }

    async loadEyeShapes () {
        const response = await fetch(`${FILE_BASE}/ohbot.obe`);
        const xmlText = await response.text();
        const xmlDoc = (new DOMParser()).parseFromString(xmlText, 'text/xml');
        const shapes = xmlDoc.getElementsByTagName('EyeShape');
        const shapeList = [];

        for (let i = 0; i < shapes.length; i++) {
            const eyeShape = shapes[i];
            shapeList.push({
                name: eyeShape.getElementsByTagName('Name')[0].textContent || '',
                hexString: eyeShape.getElementsByTagName('Hex')[0].textContent || '',
                autoMirror: eyeShape.getElementsByTagName('AutoMirror')[0].textContent === 'true',
                pupilRangeX: parseInt(eyeShape.getElementsByTagName('PupilRangeX')[0].textContent || '5', 10),
                pupilRangeY: parseInt(eyeShape.getElementsByTagName('PupilRangeY')[0].textContent || '5', 10)
            });
        }

        this.controllerState.shapeList = shapeList;
        this.emitStatus();
    }

    async getMotorDefinitionsFromFlash () {
        for (let index = 0; index < this.controllerState.motorMins.length; index++) {
            this.writeToStream(`u${index.toString().padStart(2, '0')}`);
            let found = false;
            const start = Date.now();
            while (!found && (Date.now() - start) < 2000) {
                const ack = await this.readLineWithTimeout(500);
                if (!ack || ack.indexOf('S:') !== 0 || ack.indexOf(',') === -1) {
                    continue;
                }
                const bits = ack.split(',');
                const serialIndex = this.listParse(bits, -1, 'S');
                if (serialIndex !== index) continue;
                const lo = this.listParse(bits, -1, 'L');
                const hi = this.listParse(bits, -1, 'H');
                if (lo >= 0 && hi <= 180) {
                    this.controllerState.motorMins[index] = lo;
                    this.controllerState.motorMaxs[index] = hi;
                }
                found = true;
            }
        }
    }

    async detectRobot (fullValue) {
        let detectedRobot = 'none';
        let version = '';
        let robotState = null;
        let flashedRobotName = null;

        if (fullValue.indexOf('Servo Control SVer:') === 0) {
            const after = fullValue.substring('Servo Control SVer:'.length).trim();
            const bits = after.split(',');
            version = (bits[0] || '').trim();
            robotState = bits[1] ? bits[1].trim() : null;
        } else if (fullValue.indexOf('SVer:') === 0) {
            const after = fullValue.substring('SVer:'.length).trim();
            const bits = after.split(',');
            version = (bits[0] || '').trim();
            robotState = bits[1] ? bits[1].trim() : null;
        }

        const versionUpper = version.toUpperCase();
        if (versionUpper.indexOf('V2') === 0 || versionUpper.indexOf('V3') === 0) {
            if (robotState === '0' || robotState === '1') {
                const numericVersion = parseFloat(versionUpper.replace(/[^\d.]/g, ''));
                if (numericVersion >= 2.09 && numericVersion <= 2.18) {
                    this.writeToStream('R');
                    const flashed = await this.readLineWithTimeout(1000);
                    if (flashed.indexOf('FLASHED') === 0) {
                        const parts = flashed.split(':');
                        flashedRobotName = parts[3] ? parts[3].trim().toLowerCase() : null;
                        detectedRobot = flashedRobotName === 'picoh' ? 'picoh' : 'ohbot';
                    } else {
                        detectedRobot = 'ohbot';
                    }
                } else {
                    detectedRobot = 'ohbot';
                }
            } else {
                detectedRobot = 'picoh';
            }
        } else if (versionUpper.indexOf('V1') === 0) {
            detectedRobot = 'ohbot';
        }

        return {detectedRobot, flashedRobotName};
    }

    async connect () {
        if (this.controllerState.connected || this.controllerState.isConnecting) return;
        if (!navigator.serial) {
            // eslint-disable-next-line no-alert
            window.alert('This browser does not support Web Serial.');
            return;
        }

        this.updateStatus({isConnecting: true});

        try {
            this.serialPort = await navigator.serial.requestPort();
            await this.serialPort.open({baudRate: 115200});

            const TextEncoderStreamClass = window.TextEncoderStream;
            const TextDecoderStreamClass = window.TextDecoderStream;

            const encoder = new TextEncoderStreamClass();
            this.encoderClosed = encoder.readable.pipeTo(this.serialPort.writable);
            this.outputStream = encoder.writable;
            this.writer = this.outputStream.getWriter();

            const decoder = new TextDecoderStreamClass();
            this.decoderClosed = this.serialPort.readable.pipeTo(decoder.writable);
            this.inputStream = decoder.readable;
            this.reader = this.inputStream.getReader();
            this.controllerState.readBuffer = '';

            this.writeToStream('v');
            const fullValue = await this.readLineWithTimeout(1000);
            const detection = await this.detectRobot(fullValue);

            this.updateStatus({robot: detection.detectedRobot});
            await this.loadMotorDefinitions(detection.detectedRobot);
            await this.loadEyeShapes();

            if (detection.flashedRobotName) {
                await this.getMotorDefinitionsFromFlash();
            }

            window.setTimeout(() => this.reset(detection.detectedRobot), 70);
            this.updateStatus({connected: true, isConnecting: false});
        } catch (err) {
            console.error('Connection error:', err); // eslint-disable-line no-console
            this.updateStatus({isConnecting: false});
            // eslint-disable-next-line no-alert
            window.alert('Please refresh the page and choose a port to connect to, usually "Arduino Micro".');
        }
    }

    async disconnect () {
        if (!this.controllerState.connected && !this.serialPort) {
            return;
        }

        this.reset('none');
        for (let i = 0; i < 8; i++) {
            this.detach(i);
        }

        const writer = this.writer;
        this.writer = null;
        if (writer) {
            try {
                await writer.close();
            } catch (e) {
                void e;
            }
            try {
                writer.releaseLock();
            } catch (e) {
                void e;
            }
        }

        const reader = this.reader;
        this.reader = null;
        if (reader) {
            try {
                await reader.cancel();
            } catch (e) {
                void e;
            }
            try {
                reader.releaseLock();
            } catch (e) {
                void e;
            }
        }

        if (this.encoderClosed) {
            try {
                await this.encoderClosed;
            } catch (e) {
                void e;
            }
            this.encoderClosed = null;
        }

        if (this.decoderClosed) {
            try {
                await this.decoderClosed;
            } catch (e) {
                void e;
            }
            this.decoderClosed = null;
        }

        if (this.serialPort) {
            try {
                await this.serialPort.close();
            } catch (e) {
                void e;
            }
            this.serialPort = null;
        }

        this.outputStream = null;
        this.inputStream = null;
        this.controllerState = createInitialState();
        this.emitStatus();
    }

    tick () {
        for (let i = 0; i < this.controllerState.lastMoved.length; i++) {
            if (
                Date.now() - this.controllerState.lastMoved[i] > 5000 &&
                this.controllerState.isAttached[i]
            ) {
                this.detach(i);
            }
        }
        if (
            this.controllerState.connected &&
            Date.now() - this.controllerState.lastWriteTime > 2500
        ) {
            this.writeToStream('');
        }
    }

    handleToggleConnection () {
        if (this.controllerState.connected) {
            this.disconnect();
        } else {
            this.connect();
        }
    }

    handleReset () {
        if (this.controllerState.connected) {
            this.reset();
        }
    }

    handleCommand (command) {
        if (!command || !this.controllerState.connected) return;

        switch (command[0]) {
        case 'MM':
            this.setPosition(this.indexFromMotor(command[1]), parseFloat(command[2]), false);
            break;
        case 'MC': {
            const motorIndex = this.indexFromMotor(command[1]);
            const nextPosition = this.controllerState.motorPos[motorIndex] + parseFloat(command[2]);
            this.setPosition(motorIndex, nextPosition, false);
            break;
        }
        case 'MS':
            this.controllerState.motorSpeedOverrides[this.indexFromMotor(command[1])] = NaN;
            this.controllerState.motorSpeeds[this.indexFromMotor(command[1])] =
                parseInt((25 * this.limit(parseFloat(command[2]))).toString(), 10);
            break;
        case 'CE':
            this.setColour(command[1], parseFloat(command[2]));
            break;
        case 'CC': {
            const colour = this.colourFromName(command[1]);
            this.setColour('red', colour[0]);
            this.setColour('green', colour[1]);
            this.setColour('blue', colour[2]);
            break;
        }
        case 'ES':
            this.setEyeShape(command[1], command[1]);
            break;
        case 'R':
            this.reset();
            break;
        case 'D':
            this.disconnect();
            break;
        default:
            break;
        }
    }

    render () {
        return null;
    }
}

EmbeddedRobotController.propTypes = {
    vm: PropTypes.instanceOf(VM).isRequired
};

export default EmbeddedRobotController;
