import classNames from 'classnames';
import PropTypes from 'prop-types';
import React, { Component } from 'react';

import styles from './key-modal.css';

class ApiKeyModal extends Component {
    constructor(props) {
        super(props);
        this.state = {
            apiKey: localStorage.getItem('ohbot_openai_key') || ''
        };

        this.handleApiKeyChange = this.handleApiKeyChange.bind(this);
        this.handleSaveApiKey = this.handleSaveApiKey.bind(this);
        this.handleClearApiKey = this.handleClearApiKey.bind(this);
        this.handleOverlayClick = this.handleOverlayClick.bind(this);
    }

    handleApiKeyChange(e) {
        this.setState({ apiKey: e.target.value });
    }

    handleSaveApiKey() {
        const { apiKey } = this.state;
        localStorage.setItem('ohbot_openai_key', apiKey);
        if (this.props.vm && this.props.vm.runtime) {
            this.props.vm.runtime.openAiKey = apiKey;
        }
        this.props.onClose();
        this.props.onSave(apiKey);
    }

    handleClearApiKey() {
        localStorage.removeItem('ohbot_openai_key');
        if (this.props.vm && this.props.vm.runtime) {
            this.props.vm.runtime.openAiKey = '';
        }
        this.setState({ apiKey: '' });
        this.props.onClose();
        this.props.onClear();
    }

    handleOverlayClick(e) {
        if (e.target === e.currentTarget) {
            this.props.onClose();
        }
    }

    render() {
        const { isOpen, onClose } = this.props;
        if (!isOpen) return null;

        const { apiKey } = this.state;
        const hasStoredKey = localStorage.getItem('ohbot_openai_key');
        const hasCurrentKey = apiKey.trim();

        return (
            <div
                className={styles.modalOverlay}
                onClick={this.handleOverlayClick}
            >
                <div
                    className={styles.modalContent}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className={styles.modalHeader}>
                        <h2 className={styles.modalTitle}>🔑 OpenAI API Key</h2>
                        <button
                            className={styles.closeButton}
                            onClick={onClose}
                        >
                            ×
                        </button>
                    </div>
                    <p className={styles.modalDescription}>
                        {hasStoredKey
                            ? "Update your OpenAI API key or clear it from storage."
                            : "Enter your OpenAI API key to enable AI-powered features. Your key will be stored securely in your browser."}
                    </p>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={this.handleApiKeyChange}
                        placeholder={
                            hasStoredKey
                                ? "••••••••••••••••••••••••••••"
                                : "sk-..."
                        }
                        className={styles.input}
                        autoFocus
                    />
                    <div className={styles.modalActions}>
                        {hasStoredKey && (
                            <button
                                className={styles.clearButton}
                                onClick={this.handleClearApiKey}
                            >
                                🗑️ Clear Key
                            </button>
                        )}
                        <div className={styles.actionButtons}>
                            <button
                                className={styles.cancelButton}
                                onClick={onClose}
                            >
                                Cancel
                            </button>
                            <button
                                className={classNames(
                                    styles.saveButton,
                                    !hasCurrentKey && styles.disabled
                                )}
                                onClick={this.handleSaveApiKey}
                                disabled={!hasCurrentKey}
                            >
                                {hasStoredKey ? "Update Key" : "Save Key"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

ApiKeyModal.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    onSave: PropTypes.func,
    onClear: PropTypes.func,
    vm: PropTypes.object
};

ApiKeyModal.defaultProps = {
    onSave: () => {},
    onClear: () => {}
};

export default ApiKeyModal;
