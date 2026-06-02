/**
 * DateTime Picker WebView Provider
 * Provides a dialog for selecting date and time for calendar events
 */

import * as vscode from 'vscode'

interface DateTimePickerResult {
    date: string       // YYYY-MM-DD
    time: string       // HH:MM (24-hour format)
    isAllDay: boolean
}

export class DateTimePickerProvider {
    private panel?: vscode.WebviewPanel
    private resolver?: (value: DateTimePickerResult | undefined) => void

    /**
     * Show date-time picker dialog
     */
    async pickDateTime(
        context: vscode.ExtensionContext,
        defaultDate?: string,
        defaultTime?: string,
        isAllDay?: boolean
    ): Promise<DateTimePickerResult | undefined> {
        return new Promise((resolve) => {
            this.resolver = resolve

            // Create panel
            this.panel = vscode.window.createWebviewPanel(
                'dateTimePicker',
                'Pick Date & Time',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: false,
                }
            )

            // Set HTML content
            this.panel.webview.html = this.getWebViewContent(
                defaultDate || new Date().toISOString().split('T')[0],
                defaultTime || '09:00',
                isAllDay || false
            )

            // Handle messages from webview
            this.panel.webview.onDidReceiveMessage((message) => {
                if (message.type === 'submit') {
                    this.resolver?.(message.data)
                    this.panel?.dispose()
                } else if (message.type === 'cancel') {
                    this.resolver?.(undefined)
                    this.panel?.dispose()
                }
            })

            // Handle disposal
            this.panel.onDidDispose(() => {
                this.resolver?.(undefined)
                this.panel = undefined
            })
        })
    }

    /**
     * Generate WebView HTML content
     */
    private getWebViewContent(defaultDate: string, defaultTime: string, defaultAllDay: boolean): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Pick Date & Time</title>
                <style>
                    * {
                        box-sizing: border-box;
                        margin: 0;
                        padding: 0;
                    }

                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                        background: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        padding: 24px;
                        line-height: 1.6;
                    }

                    .container {
                        max-width: 400px;
                        margin: 0 auto;
                    }

                    h1 {
                        font-size: 18px;
                        margin-bottom: 24px;
                        color: var(--vscode-descriptionForeground);
                    }

                    .form-group {
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        margin-bottom: 16px;
                    }

                    label {
                        font-size: 13px;
                        font-weight: 600;
                        color: var(--vscode-editor-foreground);
                    }

                    input[type="date"],
                    input[type="time"] {
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        padding: 8px 12px;
                        border-radius: 4px;
                        font-size: 13px;
                        font-family: inherit;
                    }

                    input[type="date"]:focus,
                    input[type="time"]:focus {
                        outline: none;
                        border-color: var(--vscode-focusBorder);
                        box-shadow: 0 0 4px rgba(0, 122, 204, 0.3);
                    }

                    .checkbox-group {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        margin-bottom: 24px;
                        padding: 12px;
                        background: var(--vscode-list-hoverBackground);
                        border-radius: 4px;
                    }

                    input[type="checkbox"] {
                        width: 16px;
                        height: 16px;
                        cursor: pointer;
                    }

                    .checkbox-label {
                        cursor: pointer;
                        font-size: 13px;
                        flex: 1;
                    }

                    .time-inputs {
                        display: flex;
                        gap: 8px;
                        margin-bottom: 24px;
                    }

                    .time-inputs input[type="time"] {
                        flex: 1;
                    }

                    .time-inputs.disabled {
                        opacity: 0.5;
                        pointer-events: none;
                    }

                    .buttons {
                        display: flex;
                        gap: 8px;
                        justify-content: flex-end;
                    }

                    button {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        padding: 8px 16px;
                        font-size: 13px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.2s;
                    }

                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }

                    .btn-secondary {
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
                    }

                    .btn-secondary:hover {
                        background: var(--vscode-button-secondaryHoverBackground);
                    }

                    .preview {
                        margin-bottom: 24px;
                        padding: 12px;
                        background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
                        border-radius: 4px;
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                    }

                    .preview strong {
                        color: var(--vscode-editor-foreground);
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>📅 Pick Date & Time</h1>

                    <div class="form-group">
                        <label for="dateInput">Date</label>
                        <input type="date" id="dateInput" value="${defaultDate}" />
                    </div>

                    <div class="checkbox-group">
                        <input type="checkbox" id="allDayCheckbox" ${defaultAllDay ? 'checked' : ''} />
                        <label for="allDayCheckbox" class="checkbox-label">All-day event</label>
                    </div>

                    <div class="form-group">
                        <label for="timeInput">Time</label>
                        <div class="time-inputs ${defaultAllDay ? 'disabled' : ''}">
                            <input type="time" id="timeInput" value="${defaultTime}" />
                        </div>
                    </div>

                    <div class="preview">
                        <strong id="previewText">Today at 9:00 AM</strong>
                    </div>

                    <div class="buttons">
                        <button class="btn-secondary" onclick="cancel()">Cancel</button>
                        <button onclick="submit()">Pick Time</button>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const dateInput = document.getElementById('dateInput');
                    const timeInput = document.getElementById('timeInput');
                    const allDayCheckbox = document.getElementById('allDayCheckbox');
                    const previewText = document.getElementById('previewText');
                    const timeContainer = document.querySelector('.time-inputs');

                    function updatePreview() {
                        const date = new Date(dateInput.value + 'T00:00:00');
                        const isAllDay = allDayCheckbox.checked;
                        
                        const dateStr = date.toLocaleDateString('en-US', { 
                            weekday: 'long', 
                            month: 'short', 
                            day: 'numeric' 
                        });

                        if (isAllDay) {
                            previewText.textContent = dateStr + ' (All day)';
                        } else {
                            const [hours, minutes] = timeInput.value.split(':');
                            const hour = parseInt(hours);
                            const ampm = hour >= 12 ? 'PM' : 'AM';
                            const displayHour = hour % 12 || 12;
                            previewText.textContent = \`\${dateStr} at \${displayHour}:\${minutes} \${ampm}\`;
                        }
                    }

                    dateInput.addEventListener('change', updatePreview);
                    timeInput.addEventListener('change', updatePreview);
                    
                    allDayCheckbox.addEventListener('change', () => {
                        timeContainer.classList.toggle('disabled');
                        updatePreview();
                    });

                    function submit() {
                        vscode.postMessage({
                            type: 'submit',
                            data: {
                                date: dateInput.value,
                                time: timeInput.value,
                                isAllDay: allDayCheckbox.checked
                            }
                        });
                    }

                    function cancel() {
                        vscode.postMessage({ type: 'cancel' });
                    }

                    // Initial preview
                    updatePreview();
                </script>
            </body>
            </html>
        `
    }
}

export default new DateTimePickerProvider()
