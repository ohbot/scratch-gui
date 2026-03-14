import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import VM from 'scratch-vm';

import styles from './simulation-controls.css';
import robotButtonStyles from '../robot/robot-connect-button.css';
import robotIcon from '../robot/icon--robot-nav.svg';

class SimulationControls extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleDocumentMouseDown',
            'handleSetRobot',
            'handleRobotStatus',
            'handleToggleMenu',
            'handleToggleConnection',
            'handleToggleSimulation',
            'handleToggleOhbot',
            'handleTogglePicoh',
            'handleMuteToggle',
            'handleReset',
            'syncStageRobotVisibility',
            'setActiveRobot'
        ]);
        this.state = {
            connected: false,
            isAttached: [],
            isConnecting: false,
            menuOpen: false,
            motorNames: [],
            motorType: [],
            robot: 'Ohbot',
            shapeCount: 0,
            simVisible: true,
            muted: false
        };
        this.menuRef = null;
    }
    componentDidMount () {
        if (this.props.vm) {
            this.props.vm.runtime.on('ROBOT_CONNECTION_STATUS', this.handleRobotStatus);
            this.props.vm.runtime.on('SIM_SET_ROBOT', this.handleSetRobot);
        }
        document.addEventListener('mousedown', this.handleDocumentMouseDown, true);
        document.addEventListener('touchstart', this.handleDocumentMouseDown, true);
    }
    componentWillUnmount () {
        if (this.props.vm) {
            this.props.vm.runtime.removeListener('ROBOT_CONNECTION_STATUS', this.handleRobotStatus);
            this.props.vm.runtime.removeListener('SIM_SET_ROBOT', this.handleSetRobot);
        }
        document.removeEventListener('mousedown', this.handleDocumentMouseDown, true);
        document.removeEventListener('touchstart', this.handleDocumentMouseDown, true);
    }
    handleDocumentMouseDown (event) {
        if (!this.state.menuOpen || !this.menuRef) return;
        if (!this.menuRef.contains(event.target)) {
            this.setState({menuOpen: false});
        }
    }
    emitSimCommand (target, method, args) {
        if (this.props.vm) {
            const command = {target, method};
            if (typeof args !== 'undefined') {
                command.args = args;
            }
            this.props.vm.runtime.emit('SIM_COMMAND', command);
        }
    }
    syncStageRobotVisibility (activeRobot) {
        if (!this.props.vm || !this.props.vm.runtime) return;
        let activeTargetId = null;
        const spriteTargets = this.props.vm.runtime.targets.filter(target =>
            target && !target.isStage && target.sprite && (
                target.sprite.name === 'Ohbot' || target.sprite.name === 'Picoh'
            )
        );
        spriteTargets.forEach(target => {
            target.postSpriteInfo({
                visible: target.sprite.name === activeRobot
            });
            if (target.sprite.name === activeRobot) {
                activeTargetId = target.id;
            }
        });
        if (activeTargetId) {
            this.props.vm.setEditingTarget(activeTargetId);
        } else {
            this.props.vm.emitTargetsUpdate(false);
        }
    }
    setActiveRobot (robot) {
        this.setState({robot: robot});
        this.syncStageRobotVisibility(robot);
        this.emitSimCommand('CameraHolder', 'ShowRobot', robot);
        if (this.props.vm) {
            this.props.vm.runtime.emit('SIM_SET_ROBOT', robot);
        }
    }
    handleSetRobot (robot) {
        if (robot === 'Ohbot' || robot === 'Picoh') {
            this.setState({robot: robot});
        }
    }
    handleRobotStatus (status) {
        const nextState = {
            connected: status.connected,
            isAttached: status.isAttached || [],
            isConnecting: status.isConnecting,
            motorNames: status.motorNames || [],
            motorType: status.motorType || [],
            shapeCount: status.shapeCount || 0
        };
        if (status.connected && status.robot && status.robot !== 'none') {
            const robotName = status.robot === 'picoh' ? 'Picoh' : 'Ohbot';
            nextState.robot = robotName;
            this.setState(nextState, () => {
                this.emitSimCommand('CameraHolder', 'ShowRobot', robotName);
                if (this.props.vm) {
                    this.props.vm.runtime.emit('SIM_SET_ROBOT', robotName);
                }
            });
            return;
        }
        this.setState(nextState);
    }
    handleToggleMenu () {
        this.setState(prevState => ({menuOpen: !prevState.menuOpen}));
    }
    handleToggleConnection () {
        if (this.props.vm) {
            this.props.vm.runtime.emit('ROBOT_TOGGLE_CONNECTION');
        }
    }
    handleToggleSimulation () {
        const newVisible = !this.state.simVisible;
        const newMuted = !newVisible;
        this.setState({
            simVisible: newVisible,
            muted: newMuted
        });
        if (this.props.vm) {
            this.props.vm.runtime.emit('SIM_SET_VISIBILITY', newVisible);
        }
        if (newVisible) {
            this.emitSimCommand('CameraHolder', 'Resume');
        } else {
            this.emitSimCommand('CameraHolder', 'Pause');
        }
        this.emitSimCommand('CameraHolder', 'SetMute', newMuted ? 0 : 1);
    }
    handleMuteToggle () {
        const newMuted = !this.state.muted;
        this.setState({muted: newMuted});
        this.emitSimCommand('CameraHolder', 'SetMute', newMuted ? 0 : 1);
    }
    handleReset () {
        this.emitSimCommand(null, 'ResetController');
        if (this.props.vm) {
            this.props.vm.runtime.emit('ROBOT_RESET');
        }
    }
    handleToggleOhbot () {
        this.setActiveRobot('Ohbot');
    }
    handleTogglePicoh () {
        this.setActiveRobot('Picoh');
    }
    render () {
        const {
            connected,
            isAttached,
            isConnecting,
            menuOpen,
            motorNames,
            motorType,
            robot,
            shapeCount,
            simVisible,
            muted
        } = this.state;
        const {compact, robotMenuOnly} = this.props;
        const visibleMotorIndices = motorType.map((type, index) => ({index, type}))
            .filter(item => {
                if (robot === 'Picoh') {
                    return ['Motor', 'Mouth Bottom'].indexOf(item.type) !== -1;
                }
                return item.type;
            })
            .map(item => item.index);
        const attachedMotorCount = visibleMotorIndices
            .filter(index => isAttached[index]).length;

        if (robotMenuOnly) {
            return (
                <div
                    className={robotButtonStyles.robotControls}
                    ref={node => {
                        this.menuRef = node;
                    }}
                >
                    <button
                        className={robotButtonStyles.robotMenuButton}
                        onClick={this.handleToggleMenu}
                        title="Robot menu"
                    >
                        <img
                            alt=""
                            className={robotButtonStyles.robotMenuIcon}
                            draggable={false}
                            src={robotIcon}
                        />
                        <span>
                            {connected ? robot : 'Connect'}
                        </span>
                    </button>
                    {menuOpen ? (
                        <div className={robotButtonStyles.robotMenu}>
                            <div className={robotButtonStyles.robotMenuTitleRow}>
                                <div className={robotButtonStyles.robotMenuTitle}>{'Robot'}</div>
                                <div className={robotButtonStyles.robotMenuState}>
                                    {isConnecting ? 'Connecting' : connected ? robot : 'Offline'}
                                </div>
                            </div>
                            <div className={robotButtonStyles.robotTopRow}>
                                <div className={robotButtonStyles.robotMenuHeader}>
                                    <div>
                                        <div className={robotButtonStyles.robotMenuLabel}>{'Status'}</div>
                                        <div className={robotButtonStyles.robotMenuValue}>
                                            {connected ? `${robot} online` : 'Offline'}
                                        </div>
                                    </div>
                                    <div
                                        className={[
                                            robotButtonStyles.robotStatusDot,
                                            connected ? robotButtonStyles.robotStatusDotConnected : ''
                                        ].join(' ')}
                                    />
                                </div>
                                <div className={robotButtonStyles.robotConnectRow}>
                                    <button
                                        className={[
                                            robotButtonStyles.robotButton,
                                            connected ? robotButtonStyles.robotButtonConnected : '',
                                            isConnecting ? robotButtonStyles.robotButtonConnecting : ''
                                        ].join(' ')}
                                        disabled={isConnecting}
                                        onClick={this.handleToggleConnection}
                                        title={connected ? 'Disconnect robot' : 'Connect robot'}
                                    >
                                        {isConnecting ? 'Connecting...' : connected ? robot : 'Connect Robot'}
                                    </button>
                                </div>
                            </div>
                            <div className={robotButtonStyles.robotMenuStats}>
                                <div className={robotButtonStyles.robotStatCard}>
                                    <div className={robotButtonStyles.robotMenuLabel}>{'Motors'}</div>
                                    <div className={robotButtonStyles.robotMenuValue}>
                                        {visibleMotorIndices.length ?
                                            `${attachedMotorCount}/${visibleMotorIndices.length} attached` :
                                            'No data'}
                                    </div>
                                </div>
                                <div className={robotButtonStyles.robotStatCard}>
                                    <div className={robotButtonStyles.robotMenuLabel}>{'Shapes'}</div>
                                    <div className={robotButtonStyles.robotMenuValue}>
                                        {robot === 'Picoh' ? shapeCount : 'N/A'}
                                    </div>
                                </div>
                            </div>
                            <div className={robotButtonStyles.robotSectionHeader}>
                                <span className={robotButtonStyles.robotMenuLabel}>{'Motors'}</span>
                                <span className={robotButtonStyles.robotSectionMeta}>
                                    {visibleMotorIndices.length || 0}
                                </span>
                            </div>
                            {visibleMotorIndices.length ? (
                                <div className={robotButtonStyles.robotMotorGrid}>
                                    {visibleMotorIndices.map(index => (
                                        <div
                                            className={[
                                                robotButtonStyles.robotMotorBadge,
                                                isAttached[index] ?
                                                    robotButtonStyles.robotMotorBadgeAttached :
                                                    ''
                                            ].join(' ')}
                                            key={index}
                                        >
                                            {motorNames[index] || `Motor ${index}`}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className={robotButtonStyles.robotEmptyState}>
                                    {'No motors available'}
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>
            );
        }

        return (
            <div
                className={robotButtonStyles.robotControls}
                ref={node => {
                    this.menuRef = node;
                }}
            >
                <button
                    className={styles.simButton}
                    onClick={this.handleReset}
                >
                    <img
                        alt="Reset"
                        height="20"
                        src="static/icons/reset.png"
                        width="24"
                    />
                </button>
                {compact ? null : (
                    <button
                        className={styles.simButton}
                        onClick={this.handleToggleOhbot}
                    >
                        <img
                            alt="Ohbot"
                            height="20"
                            src={robot === 'Ohbot' ?
                                'static/icons/OhbotLogo.png' :
                                'static/icons/OhbotLogob.png'
                            }
                            width="38"
                        />
                    </button>
                )}
                {compact ? null : (
                    <button
                        className={styles.simButton}
                        onClick={this.handleTogglePicoh}
                    >
                        <img
                            alt="Picoh"
                            height="20"
                            src={robot === 'Picoh' ?
                                'static/icons/PicohLogoPixels.png' :
                                'static/icons/PicohLogoPixelsb.png'
                            }
                            width="38"
                        />
                    </button>
                )}
                <button
                    className={styles.simButton}
                    onClick={this.handleToggleSimulation}
                >
                    <img
                        alt={simVisible ? 'Hide simulation' : 'Show simulation'}
                        height="12"
                        src={simVisible ? 'static/icons/hide.png' : 'static/icons/show.png'}
                        width="20"
                    />
                </button>
                {compact ? null : (
                    <button
                        className={styles.simButton}
                        onClick={this.handleMuteToggle}
                    >
                        <img
                            alt={muted ? 'Unmute' : 'Mute'}
                            height="20"
                            src={muted ? 'static/icons/mute.png' : 'static/icons/unmute.png'}
                            width="24"
                        />
                    </button>
                )}
            </div>
        );
    }
}

SimulationControls.propTypes = {
    compact: PropTypes.bool,
    robotMenuOnly: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired
};

SimulationControls.defaultProps = {
    compact: false,
    robotMenuOnly: false
};

export default SimulationControls;
