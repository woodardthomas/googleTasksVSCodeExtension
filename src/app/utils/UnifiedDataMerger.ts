/**
 * Utility to merge Google Tasks and Calendar events into a unified list
 */

import { tasks_v1 } from '@googleapis/tasks'
import { CalendarEvent } from '../providers/CalendarProvider'

export interface UnifiedItem {
    id: string
    type: 'task' | 'calendar' // Distinguish between source
    title: string
    dueDate: string // YYYY-MM-DD
    dueDateTime?: string // RFC 3339 with time (calendar only)
    description?: string
    completed?: boolean // For tasks
    isAllDay?: boolean // For calendar events
    recurring?: string
    source: {
        taskListId?: string
        calendarId?: string
    }
}

/**
 * Extract date from various formats
 */
function extractDate(dateString: string): string {
    // If it's a date-only format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return dateString
    }
    // If it's RFC 3339 with time, extract date part
    if (dateString.includes('T')) {
        return dateString.split('T')[0]
    }
    return dateString
}

/**
 * Convert calendar event to unified item
 */
function calendarEventToUnified(
    event: CalendarEvent,
    calendarId: string = 'primary'
): UnifiedItem {
    const startDate = event.start?.date || event.start?.dateTime || ''
    const dueDate = extractDate(startDate)

    // Ensure we have a valid event ID
    if (!event.id) {
        console.error('[UnifiedDataMerger] Calendar event missing ID:', event)
        throw new Error('Calendar event must have an ID')
    }

    // Check if this is a task event (calendar event tagged as task)
    const isTaskEvent = event.extendedProperties?.private?.isTask === 'true'

    return {
        id: event.id,
        type: isTaskEvent ? 'task' : 'calendar', // Show task events as tasks
        title: event.summary || '(No title)',
        dueDate: dueDate,
        dueDateTime: event.start?.dateTime, // Task events have time!
        description: event.description,
        isAllDay: !!event.start?.date,
        recurring: event.recurrence?.join(';'),
        source: {
            calendarId: calendarId,
        },
    }
}

/**
 * Convert task to unified item
 */
function taskToUnified(task: tasks_v1.Schema$Task, taskListId: string): UnifiedItem {
    const dueDate = extractDate(task.due || '')

    return {
        id: task.id || '',
        type: 'task',
        title: task.title || '(No title)',
        dueDate: dueDate,
        description: task.notes || undefined,
        completed: task.status === 'completed',
        recurring: undefined, // Tasks API doesn't have recurring in the response
        source: {
            taskListId: taskListId,
        },
    }
}

/**
 * Merge tasks and calendar events, sorted by date
 */
export function mergeItems(
    tasks: Array<{ task: tasks_v1.Schema$Task; taskListId: string }>,
    calendarEvents: CalendarEvent[]
): UnifiedItem[] {
    const unified: UnifiedItem[] = []

    // Add all tasks
    tasks.forEach(({ task, taskListId }) => {
        if (task.title) {
            // Only include tasks with due dates
            if (task.due) {
                unified.push(taskToUnified(task, taskListId))
            }
        }
    })

    // Add all calendar events
    calendarEvents.forEach((event) => {
        if (event.id && event.summary && event.start) {
            unified.push(calendarEventToUnified(event))
        }
    })

    // Sort by date, then by type (tasks first, then calendar)
    unified.sort((a, b) => {
        const dateCompare = a.dueDate.localeCompare(b.dueDate)
        if (dateCompare !== 0) return dateCompare

        // Same date, sort tasks before calendar events
        if (a.type === 'task' && b.type === 'calendar') return -1
        if (a.type === 'calendar' && b.type === 'task') return 1
        return 0
    })

    return unified
}

/**
 * Get items for a specific date
 */
export function getItemsForDate(items: UnifiedItem[], date: string): UnifiedItem[] {
    return items.filter((item) => item.dueDate === date)
}

/**
 * Get upcoming items (next 14 days)
 */
export function getUpcomingItems(items: UnifiedItem[], daysAhead: number = 14): UnifiedItem[] {
    const today = new Date()
    const future = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000)

    return items.filter((item) => {
        const itemDate = new Date(item.dueDate)
        return itemDate >= today && itemDate <= future
    })
}

/**
 * Get items for a specific month
 */
export function getItemsForMonth(items: UnifiedItem[], year: number, month: number): UnifiedItem[] {
    return items.filter((item) => {
        const itemDate = new Date(item.dueDate)
        return itemDate.getFullYear() === year && itemDate.getMonth() === month
    })
}

/**
 * Group items by date
 */
export function groupByDate(items: UnifiedItem[]): Map<string, UnifiedItem[]> {
    const grouped = new Map<string, UnifiedItem[]>()

    items.forEach((item) => {
        if (!grouped.has(item.dueDate)) {
            grouped.set(item.dueDate, [])
        }
        grouped.get(item.dueDate)!.push(item)
    })

    return grouped
}

export default {
    mergeItems,
    getItemsForDate,
    getUpcomingItems,
    getItemsForMonth,
    groupByDate,
    calendarEventToUnified,
    taskToUnified,
}
