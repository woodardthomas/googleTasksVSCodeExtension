/**
 * WebView provider for task scheduling UI
 * Provides a professional, non-disruptive interface for setting/editing task schedules
 */

import * as vscode from 'vscode'
import { tasks_v1 } from '@googleapis/tasks'

export interface ScheduleMessage {
  type: 'schedule' | 'cancel' | 'error'
  date?: string // YYYY-MM-DD format
  recurring?: string
  message?: string
}

export class ScheduleWebViewProvider {
  private panel?: vscode.WebviewPanel
  private currentTask?: { taskListId: string; task: tasks_v1.Schema$Task }
  private onScheduleCallback?: (schedule: { dueDateTime: string; recurring?: string }) => void
  private onCancelCallback?: () => void

  constructor(private readonly context: vscode.ExtensionContext) { }

  /**
   * Show the schedule editor for a task
   */
  async showScheduler(
    taskListId: string,
    task: tasks_v1.Schema$Task,
    onSchedule: (schedule: { dueDateTime: string; recurring?: string }) => void,
    onCancel: () => void
  ): Promise<void> {
    this.currentTask = { taskListId, task }
    this.onScheduleCallback = onSchedule
    this.onCancelCallback = onCancel

    if (!this.panel) {
      // Create new panel if it doesn't exist
      this.panel = vscode.window.createWebviewPanel(
        'scheduleEditor',
        'Schedule Task',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      )
      this.setupWebViewMessageHandling(this.panel)

      // Handle panel disposal
      this.panel.onDidDispose(() => {
        this.panel = undefined
      })
    }

    // Set initial content with task details
    this.panel.webview.html = this.getWebViewContent(task)
    this.panel.reveal()
  }

  /**
   * Setup message passing between extension and WebView
   */
  private setupWebViewMessageHandling(panel: any): void {
    panel.webview.onDidReceiveMessage((message: ScheduleMessage) => {
      switch (message.type) {
        case 'schedule':
          if (message.date && this.onScheduleCallback) {
            // Convert YYYY-MM-DD to RFC 3339 format that Google Tasks API expects
            // The API rejects date-only format, but accepts RFC 3339 with midnight UTC
            const dueRFC3339 = `${message.date}T00:00:00.000Z`

            console.log(`[Schedule] Converting date: ${message.date} → RFC3339: ${dueRFC3339}`)

            this.onScheduleCallback({
              dueDateTime: dueRFC3339,
              recurring: message.recurring,
            })

            vscode.window.showInformationMessage('Schedule saved!')
          }
          break

        case 'cancel':
          if (this.onCancelCallback) {
            this.onCancelCallback()
          }
          break

        case 'error':
          vscode.window.showErrorMessage(`Schedule error: ${message.message}`)
          break
      }
    })
  }

  /**
   * Generate WebView HTML content with embedded CSS and JavaScript
   */
  private getWebViewContent(task?: tasks_v1.Schema$Task): string {
    const taskTitle = task?.title || 'Schedule Task'

    // Convert date-only format to local timezone for display
    let currentDue = ''

    if (task?.due) {
      // Parse date in YYYY-MM-DD format (Google Tasks stores only dates)
      currentDue = task.due.split('T')[0] // Get date part only
    } else {
      // Set default to today if no due date exists
      const today = new Date()
      const year = today.getFullYear()
      const month = String(today.getMonth() + 1).padStart(2, '0')
      const day = String(today.getDate()).padStart(2, '0')
      currentDue = `${year}-${month}-${day}`
    }

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Schedule Task</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 16px;
            line-height: 1.6;
          }

          .container {
            max-width: 400px;
            margin: 0 auto;
          }

          .header {
            margin-bottom: 24px;
            border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
            padding-bottom: 12px;
          }

          .header h1 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 4px;
          }

          .task-name {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.8;
            word-break: break-word;
          }

          .form-group {
            margin-bottom: 20px;
          }

          .form-group label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
            color: var(--vscode-descriptionForeground);
          }

          .date-time-wrapper {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }

          input[type="date"],
          input[type="time"],
          select {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, rgba(255, 255, 255, 0.1));
            border-radius: 4px;
            padding: 8px 12px;
            font-size: 13px;
            font-family: inherit;
            transition: border-color 0.2s;
          }

          input[type="date"]:focus,
          input[type="time"]:focus,
          select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder, #007acc);
            box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
          }

          input[type="date"] {
            grid-column: 1 / 2;
          }

          input[type="time"] {
            grid-column: 2 / 3;
          }

          select {
            grid-column: 1 / -1;
            cursor: pointer;
          }

          .preset-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 12px;
          }

          .preset-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
            border-radius: 4px;
            padding: 8px 12px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 500;
          }

          .preset-btn:hover {
            background: var(--vscode-button-hoverBackground);
          }

          .preset-btn:active {
            transform: scale(0.98);
          }

          .time-presets {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            margin-top: 8px;
          }

          .time-preset-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
            border-radius: 3px;
            padding: 6px 8px;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s;
          }

          .time-preset-btn:hover {
            background: var(--vscode-button-hoverBackground);
          }

          .time-preset-btn.selected {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-focusBorder);
          }

          .preview-box {
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 20px;
            text-align: center;
          }

          .preview-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
          }

          .preview-text {
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-editor-foreground);
            font-family: 'Courier New', monospace;
          }

          .button-group {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 24px;
          }

          button.save {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            padding: 10px 16px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
          }

          button.save:hover {
            background: var(--vscode-button-hoverBackground);
          }

          button.save:active {
            transform: scale(0.98);
          }

          button.cancel {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
            border-radius: 4px;
            padding: 10px 16px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
          }

          button.cancel:hover {
            background: var(--vscode-button-hoverBackground);
          }

          .error {
            color: var(--vscode-errorForeground);
            font-size: 12px;
            margin-top: 4px;
            display: none;
          }

          .error.show {
            display: block;
          }

          .info-text {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 8px;
            opacity: 0.7;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⏰ Schedule Task</h1>
            <div class="task-name">${this.escapeHtml(taskTitle)}</div>
          </div>

          <div class="form-group">
            <label>📅 Select Date</label>
            <input type="date" id="dateInput" value="${currentDue}" required>
            <div class="preset-buttons">
              <button class="preset-btn" onclick="setDatePreset('today')">Today</button>
              <button class="preset-btn" onclick="setDatePreset('tomorrow')">Tomorrow</button>
              <button class="preset-btn" onclick="setDatePreset('nextweek')">Next Week</button>
              <button class="preset-btn" onclick="setDatePreset('nextmonth')">Next Month</button>
            </div>
          </div>

          <div class="form-group">
            <label>🔄 Recurrence (Optional)</label>
            <select id="recurringSelect">
              <option value="">No Recurrence</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>

          <div class="preview-box">
            <div class="preview-label">Preview</div>
            <div class="preview-text" id="preview">📅 Loading...</div>
          </div>

          <div id="error" class="error"></div>

          <div class="button-group">
            <button class="save" onclick="saveSchedule()">Save Schedule</button>
            <button class="cancel" onclick="cancelSchedule()">Cancel</button>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          function updatePreview() {
            const date = document.getElementById('dateInput').value;
            const time = document.getElementById('timeInput').value;
            const recurring = document.getElementById('recurringSelect').value;

            if (!date || !time) {
              document.getElementById('preview').textContent = '⏳ Complete all fields...';
              return;
            }

            const dateObj = new Date(date + 'T' + time);
            const formatter = new Intl.DateTimeFormat('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            });

            let preview = '📅 ' + formatter.format(dateObj);
            if (recurring) {
              preview += ' (' + recurring + ')';
            }
            document.getElementById('preview').textContent = preview;
          }

          function setDatePreset(preset) {
            const today = new Date();
            let date = new Date(today);

            switch (preset) {
              case 'today':
                date = new Date(today);
                break;
              case 'tomorrow':
                date.setDate(date.getDate() + 1);
                break;
              case 'nextweek':
                date.setDate(date.getDate() + 7);
                break;
              case 'nextmonth':
                date.setMonth(date.getMonth() + 1);
                break;
            }

            // Convert to local timezone YYYY-MM-DD format
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = year + '-' + month + '-' + day;
            
            document.getElementById('dateInput').value = dateStr;
            updatePreview();
          }

          function saveSchedule() {
            const date = document.getElementById('dateInput').value;
            const recurring = document.getElementById('recurringSelect').value;

            if (!date) {
              showError('Please select a date');
              return;
            }

            vscode.postMessage({
              type: 'schedule',
              date: date,
              recurring: recurring || undefined,
            });
          }

          function cancelSchedule() {
            vscode.postMessage({type: 'cancel'});
          }

          function showError(message) {
            const errorEl = document.getElementById('error');
            errorEl.textContent = message;
            errorEl.classList.add('show');
            setTimeout(() => {
              errorEl.classList.remove('show');
            }, 3000);
          }

          function updatePreview() {
            const date = document.getElementById('dateInput').value;
            const recurring = document.getElementById('recurringSelect').value;

            if (!date) {
              document.getElementById('preview').textContent = '⏳ Select a date...';
              return;
            }

            const dateObj = new Date(date + 'T00:00:00');
            const formatter = new Intl.DateTimeFormat('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            });

            let preview = '📅 ' + formatter.format(dateObj);
            if (recurring) {
              preview += ' (' + recurring + ')';
            }
            document.getElementById('preview').textContent = preview;
          }

          // Update preview when inputs change
          document.getElementById('dateInput').addEventListener('change', updatePreview);
          document.getElementById('recurringSelect').addEventListener('change', updatePreview);

          // Initial preview
          updatePreview();

          // Handle keyboard
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              saveSchedule();
            } else if (e.key === 'Escape') {
              cancelSchedule();
            }
          });
        </script>
      </body>
      </html>
    `
  }

  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }
    return text.replace(/[&<>"']/g, m => map[m])
  }
}
