import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import VM from 'scratch-vm';

import styles from './unity-player.css';

const UNITY_BUILD_URL = 'static/Build';
const UNITY_CONFIG = {
    dataUrl: `${UNITY_BUILD_URL}/Build.data`,
    frameworkUrl: `${UNITY_BUILD_URL}/Build.framework.js`,
    codeUrl: `${UNITY_BUILD_URL}/Build.wasm`,
    streamingAssetsUrl: 'StreamingAssets',
    companyName: 'DefaultCompany',
    productName: 'OhbotSim',
    productVersion: '0.1'
};

class UnityPlayer extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleSimCommand',
            'handleSetRobot',
            'handleSetVisibility',
            'setCanvasRef',
            'setWrapperRef'
        ]);
        this.canvasRef = null;
        this.wrapperRef = null;
        this.resizeObserver = null;
        this.unityInstance = null;
        this.robot = 'Ohbot';
        this.state = {
            visible: true
        };
    }
    componentDidMount () {
        if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
            UNITY_CONFIG.devicePixelRatio = 1;
        }

        this.setupResizeObserver();
        this.loadUnity();

        if (this.props.vm) {
            this.props.vm.runtime.on('SIM_COMMAND', this.handleSimCommand);
            this.props.vm.runtime.on('SIM_SET_ROBOT', this.handleSetRobot);
            this.props.vm.runtime.on('SIM_SET_VISIBILITY', this.handleSetVisibility);
        }
    }
    componentWillUnmount () {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.props.vm) {
            this.props.vm.runtime.removeListener('SIM_COMMAND', this.handleSimCommand);
            this.props.vm.runtime.removeListener('SIM_SET_ROBOT', this.handleSetRobot);
            this.props.vm.runtime.removeListener('SIM_SET_VISIBILITY', this.handleSetVisibility);
        }
        this.unityInstance = null;
    }
    /**
     * Handle SIM_COMMAND events from the VM runtime or SimulationControls.
     * @param {object} command - {target, method, args, onlyRobot}
     *   target: explicit Unity game object name; defaults to current robot.
     *   method: Unity method name to call.
     *   args: optional argument to pass.
     *   onlyRobot: if set, command is skipped unless active robot matches.
     */
    handleSimCommand (command) {
        if (!this.unityInstance) return;
        const {target, method, args, onlyRobot} = command;
        if (onlyRobot && this.robot !== onlyRobot) return;
        const resolvedTarget = target || this.robot;
        if (typeof args !== 'undefined') {
            this.unityInstance.SendMessage(resolvedTarget, method, args);
        } else {
            this.unityInstance.SendMessage(resolvedTarget, method);
        }
    }
    handleSetRobot (robot) {
        this.robot = robot;
        if (this.unityInstance) {
            this.unityInstance.SendMessage('CameraHolder', 'ShowRobot', robot);
        }
    }
    handleSetVisibility (visible) {
        this.setState({visible: visible});
    }
    setupResizeObserver () {
        if (!this.wrapperRef || !this.canvasRef) return;
        this.resizeObserver = new ResizeObserver(entries => {
            const rect = entries[0].contentRect;
            this.canvasRef.width = rect.width;
            this.canvasRef.height = rect.height;
            this.canvasRef.style.width = `${rect.width}px`;
            this.canvasRef.style.height = `${rect.height}px`;
        });
        this.resizeObserver.observe(this.wrapperRef);
    }
    loadUnity () {
        const script = document.createElement('script');
        script.src = `${UNITY_BUILD_URL}/Build.loader.js`;
        script.onload = () => {
            // eslint-disable-next-line no-undef
            createUnityInstance(this.canvasRef, UNITY_CONFIG, () => {})
                .then(instance => {
                    this.unityInstance = instance;
                })
                .catch(message => {
                    console.error('Unity failed to load:', message); // eslint-disable-line no-console
                });
        };
        document.body.appendChild(script);
    }
    setCanvasRef (ref) {
        this.canvasRef = ref;
    }
    setWrapperRef (ref) {
        this.wrapperRef = ref;
    }
    render () {
        return (
            <div
                className={classNames(
                    styles.unityWrapper,
                    {[styles.unityWrapperHidden]: !this.state.visible}
                )}
                ref={this.setWrapperRef}
                style={{
                    width: '100%',
                    height: '100%',
                    visibility: this.state.visible ? 'visible' : 'hidden'
                }}
            >
                <canvas
                    className={styles.unityCanvas}
                    height={this.props.height}
                    id="CursorLayer"
                    ref={this.setCanvasRef}
                    width={this.props.width}
                />
            </div>
        );
    }
}

UnityPlayer.propTypes = {
    height: PropTypes.number,
    vm: PropTypes.instanceOf(VM).isRequired,
    width: PropTypes.number
};

UnityPlayer.defaultProps = {
    height: 360,
    width: 480
};

export default UnityPlayer;
