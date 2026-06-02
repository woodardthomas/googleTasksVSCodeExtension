/**
 * WebView provider for Calendar view
 * Displays a calendar grid with Google Calendar events and Google Tasks merged together
 */

import * as vscode from 'vscode'
import { OAuth2Client } from 'googleapis-common'
import CalendarProvider, { CalendarEvent } from './CalendarProvider'
import { UnifiedItem, mergeItems, getItemsForMonth } from '../utils/UnifiedDataMerger'
import DateTimePickerProvider from './DateTimePickerProvider'

interface CalendarMessage {
  type: 'navigate' | 'selectDate' | 'clearDate' | 'createEvent' | 'editEvent' | 'deleteEvent' | 'refresh' | 'submitEventForm' | 'cancelEventForm'
  year?: number
  month?: number
  date?: string
  eventId?: string
  eventData?: any
  itemType?: 'calendar' | 'task'
  mode?: 'create' | 'edit'
  formData?: {
    title: string
    date: string
    time: string
    isAllDay: boolean
  }
}

export class CalendarWebViewProvider {
  private panel?: vscode.WebviewPanel
  private calendarProvider?: CalendarProvider
  private taskProvider?: any  // Reference to GTaskTreeProvider
  private currentMonth: number
  private currentYear: number
  private selectedDate?: string  // Track selected date (YYYY-MM-DD format)
  private eventFormMode?: 'create' | 'edit'  // Track if we're in create/edit mode
  private editingEventId?: string  // Track which event we're editing
  private editingEventData?: any  // Store original event data for editing
  private editingEventType?: 'calendar' | 'task'  // Track what type of item we're editing
  private editingTaskListId?: string  // Track which task list the task belongs to

  constructor(private readonly context: vscode.ExtensionContext) {
    const today = new Date()
    this.currentMonth = today.getMonth()
    this.currentYear = today.getFullYear()
  }

  /**
   * Initialize with OAuth client
   */
  setOAuthClient(oAuthClient: OAuth2Client) {
    this.calendarProvider = new CalendarProvider(oAuthClient)
  }

  /**
   * Set task provider for fetching tasks with schedules
   */
  setTaskProvider(taskProvider: any) {
    this.taskProvider = taskProvider
  }

  /**
   * Create a task event (calendar event tagged as task with full time support)
   */
  async createTaskEvent(eventData: {
    title: string
    description?: string
    dueDateTime: string
    recurring?: string
  }): Promise<void> {
    if (!this.calendarProvider) {
      throw new Error('Calendar provider not initialized')
    }

    try {
      // Calculate end time (1 hour after start)
      const startDate = new Date(eventData.dueDateTime)
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)

      // Parse recurring pattern if provided
      let recurrence: string[] | undefined
      if (eventData.recurring) {
        recurrence = [eventData.recurring]
      }

      await this.calendarProvider.createEvent({
        summary: eventData.title,
        description: eventData.description,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        isAllDay: false,
        recurrence,
        isTask: true, // Tag as task event
      })

      console.log('[Calendar] Task event created successfully')

      // Refresh calendar if open
      if (this.panel) {
        await this.refreshCalendar()
      }
    } catch (error) {
      console.error('[Calendar] Error creating task event:', error)
      throw error
    }
  }

  /**
   * Show the calendar view
   */
  async showCalendar(): Promise<void> {
    if (!this.calendarProvider) {
      vscode.window.showErrorMessage('Calendar provider not initialized')
      return
    }

    if (!this.panel) {
      // Create new panel
      this.panel = vscode.window.createWebviewPanel(
        'calendarView',
        'Calendar',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      )
      this.setupWebViewMessageHandling()

      // Handle panel disposal
      this.panel.onDidDispose(() => {
        this.panel = undefined
      })
    }

    // Load and display calendar
    await this.refreshCalendar()
    this.panel.reveal()
  }

  /**
   * Refresh calendar data and update view
   */
  private async refreshCalendar(): Promise<void> {
    if (!this.panel || !this.calendarProvider) return

    try {
      // Get calendar events for current month
      const events = await this.calendarProvider.getEventsForMonth(
        this.currentYear,
        this.currentMonth
      )

      // Get tasks with schedules
      let tasksWithSchedules: Array<{ task: any; taskListId: string }> = []

      if (this.taskProvider && this.taskProvider.service) {
        try {
          // Get all task lists
          const { data: listsData } = await this.taskProvider.service.tasklists.list()
          const lists = listsData.items || []

          // Get tasks from each list
          for (const list of lists) {
            if (list.id) {
              const { data: tasksData } = await this.taskProvider.service.tasks.list({
                tasklist: list.id,
                showHidden: false,
                showCompleted: false,
              })

              const tasks = tasksData.items || []
              // Only include tasks that have a due date (scheduled tasks)
              tasks.forEach((task: any) => {
                if (task.due || task.dueDateTime) {
                  tasksWithSchedules.push({
                    task: task,
                    taskListId: list.id,
                  })
                }
              })
            }
          }
        } catch (error) {
          console.error('[Calendar] Error fetching tasks:', error)
          // Continue without tasks if there's an error
        }
      }

      // Merge calendar events and tasks using UnifiedDataMerger
      const unifiedItems = mergeItems(tasksWithSchedules, events)

      // Generate HTML with merged calendar data
      this.panel.webview.html = this.getWebViewContent(unifiedItems)
    } catch (error) {
      console.error('[Calendar] Error refreshing:', error)

      // Check error type
      const errorMessage = (error as any).message || String(error)
      const errorCode = (error as any).code

      if (errorMessage.includes('API has not been used') || errorMessage.includes('is disabled')) {
        // Calendar API not enabled in Google Cloud Console
        const result = await vscode.window.showErrorMessage(
          'Google Calendar API is not enabled. You need to enable it in Google Cloud Console.',
          'Open Console',
          'Learn More',
          'Cancel'
        )

        if (result === 'Open Console') {
          const match = errorMessage.match(/project=(\d+)/)
          const projectId = match ? match[1] : '1084099120414'
          vscode.env.openExternal(vscode.Uri.parse(
            `https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=${projectId}`
          ))
        } else if (result === 'Learn More') {
          vscode.env.openExternal(vscode.Uri.parse(
            'https://support.google.com/googleapi/answer/6158841'
          ))
        }
      } else if (errorMessage.includes('Insufficient Permission') || errorCode === 403) {
        // OAuth permission error
        const result = await vscode.window.showErrorMessage(
          'Calendar access requires additional permissions. Would you like to re-authorize?',
          'Re-authorize',
          'Cancel'
        )

        if (result === 'Re-authorize') {
          vscode.commands.executeCommand('googleTasks.initUserGAuth')
        }
      } else {
        vscode.window.showErrorMessage(`Failed to load calendar: ${errorMessage}`)
      }
    }
  }

  /**
   * Setup message passing between extension and WebView
   */
  private setupWebViewMessageHandling(): void {
    if (!this.panel) return

    this.panel.webview.onDidReceiveMessage(async (message: CalendarMessage) => {
      switch (message.type) {
        case 'navigate':
          if (message.month !== undefined && message.year !== undefined) {
            this.currentMonth = message.month
            this.currentYear = message.year
            await this.refreshCalendar()
          }
          break

        case 'refresh':
          await this.refreshCalendar()
          break

        case 'createEvent':
          this.eventFormMode = 'create'
          this.editingEventId = undefined
          await this.refreshCalendar()
          break

        case 'editEvent':
          if (message.eventId) {
            this.eventFormMode = 'edit'
            this.editingEventId = message.eventId
            this.editingEventData = message.eventData
            this.editingEventType = message.itemType || 'calendar'
            this.editingTaskListId = message.eventData?.taskListId
          }
          break

        case 'submitEventForm':
          if (message.formData) {
            const itemType = message.itemType || 'calendar'
            if (message.mode === 'create') {
              if (itemType === 'task') {
                await this.submitCreateTaskFromForm(message.formData)
              } else {
                await this.submitCreateEvent(message.formData)
              }
            } else if (message.mode === 'edit' && message.eventId) {
              if (itemType === 'task') {
                await this.submitEditTask(message.eventId, message.formData, message.eventData?.taskListId)
              } else {
                await this.submitEditEvent(message.eventId, message.formData)
              }
            }
            this.eventFormMode = undefined
            this.editingEventId = undefined
            this.editingEventData = undefined
            this.editingEventType = undefined
            this.editingTaskListId = undefined
          }
          break

        case 'cancelEventForm':
          this.eventFormMode = undefined
          this.editingEventId = undefined
          this.editingEventData = undefined
          await this.refreshCalendar()
          break

        case 'deleteEvent':
          if (message.eventId) {
            await this.handleDeleteEvent(message.eventId)
          }
          break

        case 'selectDate':
          if (message.date) {
            this.selectedDate = message.date
            await this.refreshCalendar()
          }
          break

        case 'clearDate':
          this.selectedDate = undefined
          await this.refreshCalendar()
          break
      }
    })
  }

  /**
   * Handle creating a new event
   */
  private async handleCreateEvent(eventData: any): Promise<void> {
    if (!this.calendarProvider) return

    try {
      // Prompt user for event title
      const title = await vscode.window.showInputBox({
        prompt: 'Enter event title',
        placeHolder: 'New event',
        ignoreFocusOut: true
      })

      if (!title) {
        vscode.window.showWarningMessage('Event creation cancelled')
        return
      }

      // Use selected date or today
      const eventDate = this.selectedDate || new Date().toISOString().split('T')[0]

      // Show DateTime picker
      const dateTimeResult = await DateTimePickerProvider.pickDateTime(
        this.context,
        eventDate,
        '09:00',
        false
      )

      if (!dateTimeResult) {
        vscode.window.showWarningMessage('Event creation cancelled')
        return
      }

      // Build start and end times
      const { date, time, isAllDay } = dateTimeResult
      const startTime = new Date(`${date}T${time}:00`).toISOString()
      // Default to 1 hour duration
      const endDateTime = new Date(new Date(`${date}T${time}:00`).getTime() + 60 * 60 * 1000)
      const endTime = endDateTime.toISOString()

      const event = {
        summary: title,
        startDate: startTime,
        endDate: endTime,
        isAllDay: isAllDay
      }

      await this.calendarProvider.createEvent(event)
      vscode.window.showInformationMessage('Event created!')
      await this.refreshCalendar()
    } catch (error) {
      console.error('[Calendar] Error creating event:', error)
      vscode.window.showErrorMessage(`Failed to create event: ${error}`)
    }
  }

  /**
   * Handle editing an event
   */
  private async handleEditEvent(eventId: string, eventData: any): Promise<void> {
    if (!this.calendarProvider) return

    try {
      // Prompt user for new event title
      const newTitle = await vscode.window.showInputBox({
        prompt: 'Edit event title',
        placeHolder: 'Event title',
        ignoreFocusOut: true
      })

      if (newTitle === undefined) {
        vscode.window.showWarningMessage('Event edit cancelled')
        return
      }

      // Extract current date and time for the picker
      const currentDate = eventData.dueDate || new Date().toISOString().split('T')[0]
      const currentDateTime = eventData.dueDateTime || new Date().toISOString()
      const currentTime = currentDateTime.split('T')[1]?.substring(0, 5) || '09:00'
      const isCurrentAllDay = eventData.isAllDay || false

      // Show DateTime picker
      const dateTimeResult = await DateTimePickerProvider.pickDateTime(
        this.context,
        currentDate,
        currentTime,
        isCurrentAllDay
      )

      if (!dateTimeResult) {
        vscode.window.showWarningMessage('Event edit cancelled')
        return
      }

      // Build start and end times
      const { date, time, isAllDay } = dateTimeResult
      const startTime = new Date(`${date}T${time}:00`).toISOString()
      // Default to 1 hour duration
      const endDateTime = new Date(new Date(`${date}T${time}:00`).getTime() + 60 * 60 * 1000)
      const endTime = endDateTime.toISOString()

      const updateData = {
        summary: newTitle,
        startDate: startTime,
        endDate: endTime,
        isAllDay: isAllDay
      }

      await this.calendarProvider.updateEvent(eventId, updateData)
      vscode.window.showInformationMessage('Event updated!')
      await this.refreshCalendar()
    } catch (error) {
      console.error('[Calendar] Error updating event:', error)
      vscode.window.showErrorMessage(`Failed to update event: ${error}`)
    }
  }

  /**
   * Handle deleting an event
   */
  private async handleDeleteEvent(eventId: string): Promise<void> {
    if (!this.calendarProvider) return

    const confirm = await vscode.window.showWarningMessage(
      'Delete this event?',
      { modal: true },
      'Delete'
    )

    if (confirm === 'Delete') {
      try {
        await this.calendarProvider.deleteEvent(eventId)
        vscode.window.showInformationMessage('Event deleted!')
        await this.refreshCalendar()
      } catch (error) {
        console.error('[Calendar] Error deleting event:', error)
        vscode.window.showErrorMessage(`Failed to delete event: ${error}`)
      }
    }
  }

  /**
   * Submit form data to create a new event
   */
  private async submitCreateEvent(formData: any): Promise<void> {
    if (!this.calendarProvider || !formData.title) return

    try {
      // Build start and end times
      const { date, time, isAllDay } = formData
      const startTime = new Date(`${date}T${time}:00`).toISOString()
      // Default to 1 hour duration
      const endDateTime = new Date(new Date(`${date}T${time}:00`).getTime() + 60 * 60 * 1000)
      const endTime = endDateTime.toISOString()

      const event = {
        summary: formData.title,
        startDate: startTime,
        endDate: endTime,
        isAllDay: isAllDay
      }

      await this.calendarProvider.createEvent(event)
      vscode.window.showInformationMessage('Event created!')
      await this.refreshCalendar()
    } catch (error) {
      console.error('[Calendar] Error creating event:', error)
      vscode.window.showErrorMessage(`Failed to create event: ${error}`)
    }
  }

  /**
   * Submit form data to create a new task (as calendar event)
   */
  private async submitCreateTaskFromForm(formData: any): Promise<void> {
    if (!this.taskProvider || !formData.title) return

    try {
      console.log('[Calendar] Creating task from form:', formData)

      // Build due date/time for Google Task
      const { date, time, isAllDay } = formData
      let dueDate: string

      if (isAllDay) {
        // For all-day tasks, use midnight UTC
        dueDate = new Date(`${date}T00:00:00.000Z`).toISOString()
      } else {
        // For tasks with specific time
        dueDate = new Date(`${date}T${time}:00`).toISOString()
      }

      // Get the first (default) task list
      const service = this.taskProvider.service
      if (!service) {
        vscode.window.showErrorMessage('Google Tasks service not initialized')
        return
      }

      const { data } = await service.tasklists.list()
      const taskLists = data.items || []

      if (taskLists.length === 0) {
        vscode.window.showErrorMessage('No task lists found. Please create a task list first.')
        return
      }

      const defaultTaskListId = taskLists[0].id

      console.log('[Calendar] Creating task in list:', taskLists[0].title, 'with due date:', dueDate)

      // Create the Google Task with due date
      await this.taskProvider.addTask({
        tasklist: defaultTaskListId,
        requestBody: {
          title: formData.title,
          due: dueDate,
          notes: `Created from calendar on ${date}${!isAllDay ? ' at ' + time : ''}`
        }
      })

      console.log('[Calendar] Task created successfully!')
      vscode.window.showInformationMessage(`Task created in ${taskLists[0].title}!`)
      await this.refreshCalendar()
    } catch (error) {
      console.error('[Calendar] Error creating task:', error)
      vscode.window.showErrorMessage(`Failed to create task: ${error}`)
    }
  }

  /**
   * Submit form data to edit an existing event
   */
  private async submitEditEvent(eventId: string, formData: any): Promise<void> {
    if (!this.calendarProvider || !formData.title) return

    try {
      console.log('[Calendar] Submitting edit for event ID:', eventId)
      console.log('[Calendar] Form data:', formData)

      // Build start and end times
      const { date, time, isAllDay } = formData
      const startTime = new Date(`${date}T${time}:00`).toISOString()
      // Default to 1 hour duration
      const endDateTime = new Date(new Date(`${date}T${time}:00`).getTime() + 60 * 60 * 1000)
      const endTime = endDateTime.toISOString()

      const updateData = {
        summary: formData.title,
        startDate: startTime,
        endDate: endTime,
        isAllDay: isAllDay
      }

      console.log('[Calendar] Update data:', updateData)
      await this.calendarProvider.updateEvent(eventId, updateData)
      vscode.window.showInformationMessage('Event updated!')
      await this.refreshCalendar()
    } catch (error) {
      console.error('[Calendar] Error updating event:', error)
      vscode.window.showErrorMessage(`Failed to update event: ${error}`)
    }
  }

  /**
   * Submit form data to edit an existing task
   */
  private async submitEditTask(taskId: string, formData: any, taskListId?: string): Promise<void> {
    if (!this.taskProvider || !this.taskProvider.service || !formData.title) return

    try {
      console.log('[Calendar] Submitting task edit for task ID:', taskId, 'in list:', taskListId)

      // For tasks, we only update the title and due date
      // Tasks only support dates, not times
      const { date } = formData

      // Convert date to RFC 3339 format (Tasks API requirement)
      // Tasks use 'due' field with date in RFC 3339 format (e.g., "2025-10-20T00:00:00.000Z")
      const dueDate = new Date(date + 'T00:00:00.000Z').toISOString()

      const updateData: any = {
        title: formData.title,
        due: dueDate
      }

      console.log('[Calendar] Task update data:', updateData)

      // If we have the taskListId, use it directly
      if (taskListId) {
        try {
          console.log('[Calendar] Updating task directly with parameters:', { tasklist: taskListId, task: taskId })
          const response = await this.taskProvider.service.tasks.patch({
            tasklist: taskListId,
            task: taskId,
            requestBody: {
              title: formData.title,
              due: dueDate
            }
          })
          console.log('[Calendar] Task update response:', response)
          vscode.window.showInformationMessage('Task updated!')
          await this.refreshCalendar()
          return
        } catch (error) {
          console.error('[Calendar] Error updating task with known list ID:', error)
          console.error('[Calendar] Error details:', (error as any).response?.data || (error as any).message)
          // Fall through to search all lists
        }
      }

      // Tasks are stored in task lists, but we need to find which list this task belongs to
      // Search through all lists to find the task
      if (this.taskProvider && this.taskProvider.service) {
        try {
          const { data: listsData } = await this.taskProvider.service.tasklists.list()
          const lists = listsData.items || []

          for (const list of lists) {
            if (list.id) {
              try {
                console.log('[Calendar] Trying to update task in list:', list.title || list.id)
                const response = await this.taskProvider.service.tasks.patch({
                  tasklist: list.id,
                  task: taskId,
                  requestBody: {
                    title: formData.title,
                    due: dueDate
                  }
                })
                console.log('[Calendar] Task update successful')
                vscode.window.showInformationMessage('Task updated!')
                await this.refreshCalendar()
                return
              } catch (error) {
                // Task not in this list, continue to next list
                const errorCode = (error as any).code || (error as any).status
                const errorMessage = (error as any).message || String(error)
                if (errorCode !== 404 && !errorMessage.includes('not found')) {
                  console.error('[Calendar] Error updating task in list:', list.title, error)
                }
              }
            }
          }

          // If we get here, task was not found
          vscode.window.showWarningMessage('Task not found in any list')
        } catch (error) {
          console.error('[Calendar] Error updating task:', error)
          vscode.window.showErrorMessage(`Failed to update task: ${error}`)
        }
      }
    } catch (error) {
      console.error('[Calendar] Error updating task:', error)
      vscode.window.showErrorMessage(`Failed to update task: ${error}`)
    }
  }

  /**
   * Generate WebView HTML content
   */
  private getWebViewContent(items: UnifiedItem[]): string {
    // Get calendar days for current month
    const firstDay = new Date(this.currentYear, this.currentMonth, 1)
    const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0)
    const startDayOfWeek = firstDay.getDay() // 0 = Sunday
    const totalDays = lastDay.getDate()

    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ]

    // Group items by date
    const itemsByDate = new Map<string, UnifiedItem[]>()
    items.forEach((item) => {
      if (!itemsByDate.has(item.dueDate)) {
        itemsByDate.set(item.dueDate, [])
      }
      itemsByDate.get(item.dueDate)!.push(item)
    })

    // Generate calendar grid HTML
    let calendarGridHtml = ''
    let currentDay = 1 - startDayOfWeek

    for (let week = 0; week < 6; week++) {
      calendarGridHtml += '<tr>'
      for (let day = 0; day < 7; day++) {
        if (currentDay < 1 || currentDay > totalDays) {
          calendarGridHtml += '<td class="calendar-day empty"></td>'
        } else {
          const dateStr = `${this.currentYear}-${String(this.currentMonth + 1).padStart(
            2,
            '0'
          )}-${String(currentDay).padStart(2, '0')}`
          const dayItems = itemsByDate.get(dateStr) || []
          const isToday = this.isToday(currentDay)
          const isSelected = this.selectedDate === dateStr

          calendarGridHtml += `
            <td class="calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${dateStr}">
              <div class="day-number">${currentDay}</div>
              <div class="day-events">
                ${dayItems
              .slice(0, 2)
              .map(
                (item) => `
                  <div class="event-label ${item.type}" title="${this.escapeHtml(item.title)}">
                    ${item.type === 'task' ? '✓' : '📅'} ${this.escapeHtml(item.title.substring(0, 15))}${item.title.length > 15 ? '…' : ''}
                  </div>
                `
              )
              .join('')}
                ${dayItems.length > 2 ? `<div class="more-events">+${dayItems.length - 2}</div>` : ''}
              </div>
            </td>
          `
        }
        currentDay++
      }
      calendarGridHtml += '</tr>'
    }

    // Generate event list HTML
    const selectedDateEvents = this.selectedDate ? (itemsByDate.get(this.selectedDate) || []) : []
    const upcomingEvents = items.slice(0, 20)

    const selectedDateHtml = this.selectedDate ? `
      <div class="event-list selected-date-list">
        <div class="list-header">
          <h2>${this.formatDateForDisplay(this.selectedDate)}'s Events</h2>
          <button class="clear-btn" onclick="clearSelection()" title="Clear selection">×</button>
        </div>
        ${selectedDateEvents.length > 0 ? selectedDateEvents.map(
      (item) => `
      <div class="event-item ${item.type}" data-id="${item.id}" data-event-id="${item.id}" data-event-date="${item.dueDate}" data-event-time="${item.dueDateTime ? item.dueDateTime.split('T')[1]?.substring(0, 5) : '09:00'}" data-event-all-day="${!item.dueDateTime}" data-item-type="${item.type}" data-tasklist-id="${item.source?.taskListId || ''}" data-calendar-id="${item.source?.calendarId || ''}">
        <div class="event-icon">${item.type === 'task' ? '✓' : '📅'}</div>
        <div class="event-details">
          <div class="event-title">${this.escapeHtml(item.title)}</div>
          <div class="event-date">${item.dueDateTime ? this.formatTime(item.dueDateTime) : 'All day'}</div>
        </div>
        <div class="event-actions">
          <button class="icon-btn" onclick="editEvent('${item.id}', event)" title="Edit">✏️</button>
          <button class="icon-btn" onclick="deleteEvent('${item.id}')" title="Delete">🗑️</button>
        </div>
      </div>
    `
    ).join('')
        : '<p style="color: var(--vscode-descriptionForeground);">No events on this day</p>'}
      </div>
    ` : ''

    const eventListHtml = upcomingEvents
      .map(
        (item) => `
      <div class="event-item ${item.type}" data-id="${item.id}" data-event-id="${item.id}" data-event-date="${item.dueDate}" data-event-time="${item.dueDateTime ? item.dueDateTime.split('T')[1]?.substring(0, 5) : '09:00'}" data-event-all-day="${!item.dueDateTime}" data-item-type="${item.type}" data-tasklist-id="${item.source?.taskListId || ''}" data-calendar-id="${item.source?.calendarId || ''}">
        <div class="event-icon">${item.type === 'task' ? '✓' : '📅'}</div>
        <div class="event-details">
          <div class="event-title">${this.escapeHtml(item.title)}</div>
          <div class="event-date">${this.formatDate(item.dueDate)}${item.dueDateTime ? ' @ ' + this.formatTime(item.dueDateTime) : ''
          }</div>
        </div>
        <div class="event-actions">
          <button class="icon-btn" onclick="editEvent('${item.id}', event)" title="Edit">✏️</button>
          <button class="icon-btn" onclick="deleteEvent('${item.id}')" title="Delete">🗑️</button>
        </div>
      </div>
    `
      )
      .join('')

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Calendar</title>
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
            padding: 16px;
            line-height: 1.6;
          }

          .container {
            max-width: 1200px;
            margin: 0 auto;
          }

          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
          }

          .header h1 {
            font-size: 24px;
            font-weight: 600;
          }

          .nav-buttons {
            display: flex;
            gap: 8px;
          }

          .btn {
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

          .btn:hover {
            background: var(--vscode-button-hoverBackground);
          }

          .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
          }

          .calendar-container {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 24px;
            margin-bottom: 24px;
          }

          .calendar {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
            border-radius: 8px;
            padding: 16px;
          }

          .calendar table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          .calendar tbody tr {
            display: table-row;
            height: 100px;
          }

          .calendar th {
            padding: 12px 8px;
            text-align: center;
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .calendar-day {
            height: 100px;
            width: 100%;
            vertical-align: top;
            padding: 8px;
            border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
            cursor: pointer;
            transition: background 0.2s;
            position: relative;
            overflow: hidden;
            box-sizing: border-box;
            display: table-cell;
          }

          .calendar-day:hover {
            background: var(--vscode-list-hoverBackground);
          }

          .calendar-day.empty {
            background: var(--vscode-editor-background);
            opacity: 0.3;
            cursor: default;
          }

          .calendar-day.today {
            background: var(--vscode-list-activeSelectionBackground);
            border-color: var(--vscode-focusBorder);
          }

          .calendar-day.selected {
            background: var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
            border-width: 2px;
            box-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
          }

          .day-number {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 4px;
          }

          .day-events {
            display: flex;
            flex-wrap: wrap;
            gap: 2px;
            flex-direction: column;
            max-height: 64px;
            overflow: hidden;
          }

          .event-label {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 3px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 100%;
            height: 18px;
            line-height: 1;
            box-sizing: border-box;
          }

          .event-label.task {
            background: var(--vscode-charts-blue);
            color: white;
          }

          .event-label.calendar {
            background: var(--vscode-charts-purple);
            color: white;
          }

          .more-events {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
          }

          .event-dot {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: bold;
          }

          .event-dot.task {
            background: var(--vscode-charts-blue);
            color: white;
          }

          .event-dot.calendar {
            background: var(--vscode-charts-purple);
            color: white;
          }

          .event-list {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
            border-radius: 8px;
            padding: 16px;
            max-height: 600px;
            overflow-y: auto;
          }

          .event-list h2 {
            font-size: 16px;
            margin-bottom: 16px;
            color: var(--vscode-descriptionForeground);
          }

          .event-list.selected-date-list {
            background: var(--vscode-editor-background);
            border: 2px solid var(--vscode-focusBorder);
            margin-bottom: 16px;
            order: -1;
          }

          .list-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
          }

          .list-header h2 {
            margin: 0;
            font-size: 16px;
            color: var(--vscode-focusBorder);
          }

          .clear-btn {
            background: transparent;
            border: none;
            color: var(--vscode-descriptionForeground);
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: all 0.2s;
          }

          .clear-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
            color: var(--vscode-editor-foreground);
          }

          .event-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            margin-bottom: 8px;
            background: var(--vscode-list-hoverBackground);
            border-radius: 6px;
            transition: all 0.2s;
          }

          .event-item:hover {
            background: var(--vscode-list-activeSelectionBackground);
          }

          .event-icon {
            font-size: 20px;
          }

          .event-details {
            flex: 1;
          }

          .event-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 2px;
          }

          .event-date {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
          }

          .event-actions {
            display: flex;
            gap: 4px;
          }

          .icon-btn {
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 16px;
            padding: 4px;
            border-radius: 4px;
            transition: background 0.2s;
          }

          .icon-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
          }

          /* Inline Event Form Styles */
          #eventForm {
            background: var(--vscode-editor-background);
            border: 2px solid var(--vscode-focusBorder);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 24px;
            display: none;
          }

          #eventForm.active {
            display: block;
          }

          .form-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--vscode-editor-foreground);
          }

          .form-group {
            margin-bottom: 12px;
          }

          .form-group label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 6px;
            color: var(--vscode-editor-foreground);
          }

          .form-group input,
          .form-group textarea {
            width: 100%;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
            color: var(--vscode-input-foreground);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 13px;
            font-family: inherit;
            transition: border-color 0.2s;
          }

          .form-group input:focus,
          .form-group textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 1px var(--vscode-focusBorder);
          }

          .form-group textarea {
            resize: vertical;
            min-height: 60px;
          }

          .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }

          .form-row.full {
            grid-template-columns: 1fr;
          }

          .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .checkbox-group input[type="checkbox"] {
            width: auto;
            margin: 0;
          }

          .form-options-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
          }

          .radio-group-inline {
            display: flex;
            gap: 8px;
            align-items: center;
          }

          .radio-label-inline {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            border-radius: 3px;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 12px;
            white-space: nowrap;
          }

          .radio-label-inline:hover {
            background: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
          }

          .radio-label-inline input[type="radio"] {
            margin: 0;
            cursor: pointer;
            width: 12px;
            height: 12px;
          }

          .radio-label-inline input[type="radio"]:checked + span {
            font-weight: 600;
            color: var(--vscode-textLink-activeForeground);
          }

          .radio-label-inline span {
            font-size: 12px;
            line-height: 1;
          }

          .form-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
          }

          .form-actions .btn {
            padding: 6px 12px;
            font-size: 12px;
          }

          @media (max-width: 900px) {
            .calendar-container {
              grid-template-columns: 1fr;
            }

            .form-row {
              grid-template-columns: 1fr;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📅 ${monthNames[this.currentMonth]} ${this.currentYear}</h1>
            <div class="nav-buttons">
              <button class="btn btn-secondary" onclick="navigateMonth(-1)">← Previous</button>
              <button class="btn btn-secondary" onclick="navigateToday()">Today</button>
              <button class="btn btn-secondary" onclick="navigateMonth(1)">Next →</button>
              <button class="btn btn-secondary" onclick="refreshCalendar()" title="Refresh calendar">🔄 Refresh</button>
              <button class="btn" onclick="createNewEvent()">+ New Event</button>
            </div>
          </div>

          <!-- Inline Event Form -->
          <div id="eventForm" onclick="event.stopPropagation()">
            <div class="form-title" id="formTitle">New Event</div>
            <form onsubmit="submitEventForm(event)">
              <div class="form-group">
                <label for="eventTitle">Title</label>
                <input type="text" id="eventTitle" name="title" placeholder="Event title" required onclick="event.stopPropagation()">
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label for="eventDate">Date</label>
                  <input type="date" id="eventDate" name="date" required onclick="event.stopPropagation()" onchange="event.stopPropagation()">
                </div>
                <div class="form-group" id="timeFormGroup">
                  <label for="eventTime">Time</label>
                  <input type="time" id="eventTime" name="time" required onclick="event.stopPropagation()" onchange="event.stopPropagation()">
                </div>
              </div>

              <div class="form-group" id="allDayFormGroup">
                <div class="form-options-row">
                  <div class="checkbox-group">
                    <input type="checkbox" id="eventAllDay" name="isAllDay" onchange="toggleTimeInput()" onclick="event.stopPropagation()">
                    <label for="eventAllDay" style="margin: 0;">All-day event</label>
                  </div>
                  <div class="radio-group-inline">
                    <label class="radio-label-inline">
                      <input type="radio" id="eventTypeEvent" name="eventType" value="calendar" checked onchange="toggleEventType()" onclick="event.stopPropagation()">
                      <span>📅 Event</span>
                    </label>
                    <label class="radio-label-inline">
                      <input type="radio" id="eventTypeTask" name="eventType" value="task" onchange="toggleEventType()" onclick="event.stopPropagation()">
                      <span>✓ Task</span>
                    </label>
                  </div>
                </div>
              </div>

              <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="cancelEventForm()">Cancel</button>
                <button type="submit" class="btn" id="saveButton">Create Event</button>
              </div>
            </form>
          </div>

          <div class="calendar-container">
            <div class="calendar">
              <table>
                <thead>
                  <tr>
                    <th>Sun</th>
                    <th>Mon</th>
                    <th>Tue</th>
                    <th>Wed</th>
                    <th>Thu</th>
                    <th>Fri</th>
                    <th>Sat</th>
                  </tr>
                </thead>
                <tbody>
                  ${calendarGridHtml}
                </tbody>
              </table>
            </div>

            <div class="event-list">
              ${selectedDateHtml}
              <h2>Upcoming Events</h2>
              ${eventListHtml || '<p style="color: var(--vscode-descriptionForeground);">No events scheduled</p>'}
            </div>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          let selectedDate = ${this.selectedDate ? `'${this.selectedDate}'` : 'null'};
          const allItems = ${JSON.stringify(items)};
          
          // Track clicks to prevent single-click handler from firing during double-click
          const dayClickTimeouts = new Map();
          const DOUBLE_CLICK_DELAY = 300;

          function navigateMonth(direction) {
            const currentMonth = ${this.currentMonth};
            const currentYear = ${this.currentYear};
            let newMonth = currentMonth + direction;
            let newYear = currentYear;

            if (newMonth < 0) {
              newMonth = 11;
              newYear--;
            } else if (newMonth > 11) {
              newMonth = 0;
              newYear++;
            }

            vscode.postMessage({
              type: 'navigate',
              month: newMonth,
              year: newYear
            });
          }

          function navigateToday() {
            const today = new Date();
            vscode.postMessage({
              type: 'navigate',
              month: today.getMonth(),
              year: today.getFullYear()
            });
          }

          function refreshCalendar() {
            vscode.postMessage({ type: 'refresh' });
          }

          function clearSelection() {
            selectedDate = null;
            document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
            const selectedDateList = document.querySelector('.selected-date-list');
            if (selectedDateList) {
              selectedDateList.remove();
            }
            vscode.postMessage({ type: 'clearDate' });
          }

          function createNewEvent() {
            // Show form for creating new event
            const today = new Date().toISOString().split('T')[0];
            showEventForm('create', null, {
              title: '',
              date: today,
              time: '09:00',
              isAllDay: false
            });
          }

          function editEvent(eventId, clickEvent) {
            // Extract event data from the closest event-item element
            const eventItem = clickEvent ? clickEvent.target.closest('.event-item') : document.querySelector(\`[data-event-id="\${eventId}"]\`);
            if (eventItem) {
              const titleEl = eventItem.querySelector('.event-title');
              const title = titleEl ? titleEl.textContent.trim() : '';
              const date = eventItem.dataset.eventDate || '';
              const time = eventItem.dataset.eventTime || '09:00';
              const isAllDay = eventItem.dataset.eventAllDay === 'true';
              const itemType = eventItem.dataset.itemType || 'calendar';
              const taskListId = eventItem.dataset.tasklistId || '';
              const calendarId = eventItem.dataset.calendarId || '';
              
              // Show the form immediately with the extracted data
              showEventForm('edit', eventId, {
                title: title,
                date: date,
                time: time,
                isAllDay: isAllDay,
                itemType: itemType,
                taskListId: taskListId,
                calendarId: calendarId
              });
              
              // Also notify extension about the edit (for audit/logging if needed)
              vscode.postMessage({ 
                type: 'editEvent', 
                eventId: eventId,
                itemType: itemType,
                eventData: { 
                  itemType: itemType,
                  taskListId: taskListId,
                  calendarId: calendarId
                } 
              });
            }
          }

          function showEventForm(mode, eventId, eventData) {
            const form = document.getElementById('eventForm');
            const formTitle = document.getElementById('formTitle');
            const titleInput = document.getElementById('eventTitle');
            const dateInput = document.getElementById('eventDate');
            const timeInput = document.getElementById('eventTime');
            const allDayCheckbox = document.getElementById('eventAllDay');
            const eventTypeEvent = document.getElementById('eventTypeEvent');
            const eventTypeTask = document.getElementById('eventTypeTask');

            // Check if form elements exist
            if (!form || !formTitle || !titleInput || !dateInput || !timeInput || !allDayCheckbox) {
              console.error('[Calendar] Form elements not found. Missing:', {
                form: !form,
                formTitle: !formTitle,
                titleInput: !titleInput,
                dateInput: !dateInput,
                timeInput: !timeInput,
                allDayCheckbox: !allDayCheckbox
              });
              return;
            }

            const itemType = eventData.itemType || 'calendar';
            const isTask = itemType === 'task';
            
            // Set radio buttons based on item type
            if (eventTypeEvent && eventTypeTask) {
              if (isTask) {
                eventTypeTask.checked = true;
              } else {
                eventTypeEvent.checked = true;
              }
            }
            
            // Update title based on type
            if (mode === 'create') {
              formTitle.textContent = isTask ? 'New Task' : 'New Event';
            } else {
              formTitle.textContent = isTask ? 'Edit Task' : 'Edit Event';
            }
            
            titleInput.value = eventData.title || '';
            titleInput.placeholder = isTask ? 'Task title' : 'Event title';
            dateInput.value = eventData.date || new Date().toISOString().split('T')[0];
            timeInput.value = eventData.time || '09:00';
            allDayCheckbox.checked = eventData.isAllDay || false;

            // Store the mode and item type for form submission
            form.dataset.mode = mode;
            form.dataset.eventId = eventId || '';
            form.dataset.itemType = itemType;

            // Both calendar events and tasks support times since tasks are stored as calendar events
            const timeFormGroup = document.getElementById('timeFormGroup');
            const allDayFormGroup = document.getElementById('allDayFormGroup');
            const saveButton = document.getElementById('saveButton');
            
            // Update button text based on type
            if (saveButton) {
              saveButton.textContent = mode === 'create' 
                ? (isTask ? 'Create Task' : 'Create Event')
                : (isTask ? 'Save Task' : 'Save Event');
            }
            
            // Ensure time fields are visible
            if (timeFormGroup) timeFormGroup.style.display = '';
            if (allDayFormGroup) allDayFormGroup.style.display = '';
            
            // Enable time input based on all-day checkbox
            toggleTimeInput();
            
            form.classList.add('active');
            titleInput.focus();
          }

          function toggleTimeInput() {
            const allDayCheckbox = document.getElementById('eventAllDay');
            const timeInput = document.getElementById('eventTime');
            if (!allDayCheckbox || !timeInput) return;
            timeInput.disabled = allDayCheckbox.checked;
            if (allDayCheckbox.checked) {
              timeInput.value = '00:00';
            }
          }

          function toggleEventType() {
            const eventTypeTask = document.getElementById('eventTypeTask');
            const saveButton = document.getElementById('saveButton');
            const formTitle = document.getElementById('formTitle');
            const form = document.getElementById('eventForm');
            const titleInput = document.getElementById('eventTitle');
            
            if (!eventTypeTask || !saveButton || !formTitle || !form) return;

            const isTask = eventTypeTask.checked;
            const mode = form.dataset.mode || 'create';
            
            // Update form title
            if (mode === 'create') {
              formTitle.textContent = isTask ? 'New Task' : 'New Event';
            } else {
              formTitle.textContent = isTask ? 'Edit Task' : 'Edit Event';
            }
            
            // Update button text
            saveButton.textContent = mode === 'create' 
              ? (isTask ? 'Create Task' : 'Create Event')
              : (isTask ? 'Save Task' : 'Save Event');
            
            // Update placeholder
            titleInput.placeholder = isTask ? 'Task title' : 'Event title';
            
            // Note: We keep time fields visible for both types since calendar-based tasks support times
          }

          function submitEventForm(event) {
            event.preventDefault();

            const form = document.getElementById('eventForm');
            const titleInput = document.getElementById('eventTitle');
            const dateInput = document.getElementById('eventDate');
            const timeInput = document.getElementById('eventTime');
            const allDayCheckbox = document.getElementById('eventAllDay');
            const eventTypeTask = document.getElementById('eventTypeTask');

            if (!form || !titleInput || !dateInput || !timeInput || !allDayCheckbox) {
              console.error('[Calendar] Form elements not found during submit');
              return;
            }

            if (!titleInput.value.trim()) {
              alert('Please enter an event title');
              titleInput.focus();
              return;
            }

            // Get the selected event type from radio buttons
            const selectedItemType = eventTypeTask && eventTypeTask.checked ? 'task' : 'calendar';

            const formData = {
              title: titleInput.value,
              date: dateInput.value,
              time: allDayCheckbox.checked ? '00:00' : timeInput.value,
              isAllDay: allDayCheckbox.checked
            };

            const mode = form.dataset.mode || 'create';
            const eventId = form.dataset.eventId || null;

            vscode.postMessage({
              type: 'submitEventForm',
              mode: mode,
              eventId: eventId,
              itemType: selectedItemType,
              formData: formData
            });

            cancelEventForm();
          }

          function cancelEventForm() {
            const form = document.getElementById('eventForm');
            if (!form) {
              console.error('[Calendar] Form element not found during cancel');
              return;
            }
            form.classList.remove('active');
            vscode.postMessage({ type: 'cancelEventForm' });
          }

          function deleteEvent(eventId) {
            vscode.postMessage({ type: 'deleteEvent', eventId: eventId });
          }

          function updateCalendarDayStyles(newSelectedDate) {
            // Update calendar day highlights
            document.querySelectorAll('.calendar-day').forEach(day => {
              day.classList.remove('selected');
              if (day.dataset.date === newSelectedDate) {
                day.classList.add('selected');
              }
            });
          }

          function updateEventListForDate(dateStr) {
            // Find or create the selected-date-list container
            let selectedDateList = document.querySelector('.selected-date-list');
            const eventListContainer = document.querySelector('.event-list');
            
            if (!selectedDateList) {
              selectedDateList = document.createElement('div');
              selectedDateList.className = 'event-list selected-date-list';
              eventListContainer.insertBefore(selectedDateList, eventListContainer.querySelector('h2'));
            }
            
            // Clear previous content
            selectedDateList.innerHTML = '';
            
            // Filter items for this date
            const dateItems = allItems.filter(item => item.dueDate === dateStr);
            
            // Format date for display
            const date = new Date(dateStr + 'T00:00:00');
            const dateStr2 = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            
            // Create header
            const header = document.createElement('div');
            header.className = 'list-header';
            
            const title = document.createElement('h2');
            title.textContent = dateStr2 + "'s Events";
            
            const clearBtn = document.createElement('button');
            clearBtn.className = 'clear-btn';
            clearBtn.title = 'Clear selection';
            clearBtn.textContent = '×';
            clearBtn.onclick = clearSelection;
            
            header.appendChild(title);
            header.appendChild(clearBtn);
            selectedDateList.appendChild(header);
            
            if (dateItems.length > 0) {
              dateItems.forEach(item => {
                const itemTime = item.dueDateTime ? item.dueDateTime.split('T')[1]?.substring(0, 5) : '09:00';
                const itemType = item.type === 'task' ? '✓' : '📅';
                const displayTime = item.dueDateTime ? formatTime(item.dueDateTime) : 'All day';
                
                const eventItem = document.createElement('div');
                eventItem.className = 'event-item ' + item.type;
                eventItem.dataset.id = item.id;
                eventItem.dataset.eventId = item.id;
                eventItem.dataset.eventDate = item.dueDate;
                eventItem.dataset.eventTime = itemTime;
                eventItem.dataset.eventAllDay = !item.dueDateTime;
                eventItem.dataset.itemType = item.type;
                eventItem.dataset.tasklistId = item.source?.taskListId || '';
                eventItem.dataset.calendarId = item.source?.calendarId || '';
                
                const icon = document.createElement('div');
                icon.className = 'event-icon';
                icon.textContent = itemType;
                
                const details = document.createElement('div');
                details.className = 'event-details';
                
                const eventTitle = document.createElement('div');
                eventTitle.className = 'event-title';
                eventTitle.textContent = item.title;
                
                const eventDate = document.createElement('div');
                eventDate.className = 'event-date';
                eventDate.textContent = displayTime;
                
                details.appendChild(eventTitle);
                details.appendChild(eventDate);
                
                const actions = document.createElement('div');
                actions.className = 'event-actions';
                
                const editBtn = document.createElement('button');
                editBtn.className = 'icon-btn';
                editBtn.title = 'Edit';
                editBtn.textContent = '✏️';
                editBtn.onclick = (e) => editEvent(item.id, e);
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'icon-btn';
                deleteBtn.title = 'Delete';
                deleteBtn.textContent = '🗑️';
                deleteBtn.onclick = () => deleteEvent(item.id);
                
                actions.appendChild(editBtn);
                actions.appendChild(deleteBtn);
                
                eventItem.appendChild(icon);
                eventItem.appendChild(details);
                eventItem.appendChild(actions);
                
                // Add double-click handler
                eventItem.addEventListener('dblclick', (e) => {
                  const eventId = e.currentTarget.dataset.eventId;
                  if (eventId) {
                    const titleEl = e.currentTarget.querySelector('.event-title');
                    const title = titleEl ? titleEl.textContent.trim() : '';
                    const date = e.currentTarget.dataset.eventDate || '';
                    const time = e.currentTarget.dataset.eventTime || '09:00';
                    const isAllDay = e.currentTarget.dataset.eventAllDay === 'true';
                    showEventForm('edit', eventId, {
                      title: title,
                      date: date,
                      time: time,
                      isAllDay: isAllDay,
                      itemType: e.currentTarget.dataset.itemType || 'calendar'
                    });
                  }
                });
                
                selectedDateList.appendChild(eventItem);
              });
            } else {
              const noEvents = document.createElement('p');
              noEvents.style.color = 'var(--vscode-descriptionForeground)';
              noEvents.textContent = 'No events on this day';
              selectedDateList.appendChild(noEvents);
            }
          }

          function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          function formatTime(isoDateTime) {
            const date = new Date(isoDateTime);
            return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          }

          // Handle calendar day clicks with double-click protection
          document.querySelectorAll('.calendar-day:not(.empty)').forEach(day => {
            let lastClickTime = 0;
            const dateAttr = day.dataset.date;
            
            day.addEventListener('click', (e) => {
              const now = Date.now();
              const timeSinceLastClick = now - lastClickTime;
              lastClickTime = now;
              
              // If this click is likely part of a double-click, ignore it
              if (timeSinceLastClick < DOUBLE_CLICK_DELAY && timeSinceLastClick > 0) {
                return;
              }
              
              // Cancel any existing timeout for this day
              const existingTimeout = dayClickTimeouts.get(dateAttr);
              if (existingTimeout) {
                clearTimeout(existingTimeout);
              }
              
              // Capture the date immediately, don't use e.currentTarget later
              const date = dateAttr;
              
              // Delay the single-click handler to wait and see if a double-click follows
              const timeout = setTimeout(() => {
                if (date) {
                  console.log('[Calendar] Single-click on date:', date, 'current selectedDate:', selectedDate);
                  // Toggle selection: if clicking the same day, deselect it
                  if (selectedDate === date) {
                    console.log('[Calendar] Clearing date selection');
                    // Clear selection locally
                    selectedDate = null;
                    document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
                    const selectedDateList = document.querySelector('.selected-date-list');
                    if (selectedDateList) {
                      selectedDateList.remove();
                    }
                  } else {
                    console.log('[Calendar] Selecting date:', date);
                    // Update selection locally
                    selectedDate = date;
                    updateCalendarDayStyles(date);
                    updateEventListForDate(date);
                  }
                }
                dayClickTimeouts.delete(dateAttr);
              }, DOUBLE_CLICK_DELAY);
              
              dayClickTimeouts.set(dateAttr, timeout);
            });

            // Handle double-click to create new event
            day.addEventListener('dblclick', (e) => {
              // Cancel the pending single-click handler for this day
              const existingTimeout = dayClickTimeouts.get(dateAttr);
              if (existingTimeout) {
                clearTimeout(existingTimeout);
                dayClickTimeouts.delete(dateAttr);
              }
              
              const date = dateAttr;
              if (date) {
                console.log('[Calendar] Double-click on date:', date);
                showEventForm('create', null, {
                  title: '',
                  date: date,
                  time: '09:00',
                  isAllDay: false
                });
              }
            });
          });

          // Handle double-click on event items to edit
          document.querySelectorAll('.event-item').forEach(item => {
            item.addEventListener('dblclick', (e) => {
              const eventId = e.currentTarget.dataset.eventId;
              if (eventId) {
                // Extract event data from the element
                const titleEl = e.currentTarget.querySelector('.event-title');
                const dateEl = e.currentTarget.querySelector('.event-date');
                const title = titleEl ? titleEl.textContent.trim() : '';
                const date = e.currentTarget.dataset.eventDate || '';
                const time = e.currentTarget.dataset.eventTime || '09:00';
                const isAllDay = e.currentTarget.dataset.eventAllDay === 'true';

                showEventForm('edit', eventId, {
                  title: title,
                  date: date,
                  time: time,
                  isAllDay: isAllDay
                });
              }
            });
          });

          // Handle clicks on empty space to deselect
          document.addEventListener('click', (e) => {
            // Only deselect if clicking on background (body or container) not on interactive elements
            const isClickableElement = e.target.closest('.calendar-day, .event-item, .event-list, .event-actions, button, .icon-btn, .clear-btn, .list-header h2, #eventForm');
            if (!isClickableElement && selectedDate) {
              clearSelection();
            }
          });
        </script>
      </body>
      </html>
    `
  }

  /**
   * Check if a day is today
   */
  private isToday(day: number): boolean {
    const today = new Date()
    return (
      today.getDate() === day &&
      today.getMonth() === this.currentMonth &&
      today.getFullYear() === this.currentYear
    )
  }

  /**
   * Format date for display
   */
  private formatDate(dateStr: string): string {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  /**
   * Format date for display in selected day header (e.g., "Monday, October 20")
   */
  private formatDateForDisplay(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  }

  /**
   * Format time for display
   */
  private formatTime(dateTimeStr: string): string {
    const date = new Date(dateTimeStr)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  /**
   * Escape HTML
   */
  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }
    return text.replace(/[&<>"']/g, (m) => map[m])
  }
}

export default CalendarWebViewProvider
