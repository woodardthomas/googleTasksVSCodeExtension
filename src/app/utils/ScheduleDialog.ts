/**
 * Interactive UI for setting task schedules
 * Provides dialogs for date/time selection with presets and custom input
 */

import { window, QuickPickItem } from 'vscode'
import {
    DATE_PRESETS,
    TIME_PRESETS,
    RECURRING_PRESETS,
    toRFC3339WithTime,
    parseCustomDate,
    parseCustomTime,
    formatTime,
} from './DateTimeUtils'

export interface ScheduleDialog {
    dueDateTime?: string // RFC 3339 format
    recurring?: string
}

/**
 * Show interactive schedule picker
 * Returns the user's schedule selection or undefined if cancelled
 */
export async function showScheduleDialog(currentDue?: string, currentRecurring?: string): Promise<ScheduleDialog | undefined> {
    // Step 1: Choose date
    const selectedDate = await showDatePicker(currentDue)
    if (selectedDate === undefined) {
        return undefined // User cancelled
    }

    // Step 2: Choose time
    const selectedTime = await showTimePicker(currentDue)
    if (selectedTime === undefined) {
        return undefined // User cancelled
    }

    // Step 3: Choose recurring pattern
    const selectedRecurring = await showRecurringPicker(currentRecurring)
    if (selectedRecurring === undefined) {
        return undefined // User cancelled
    }

    const dueDateTime = toRFC3339WithTime(selectedDate, selectedTime.hours, selectedTime.minutes)

    return {
        dueDateTime,
        recurring: selectedRecurring,
    }
}

/**
 * Show date picker with quick presets and custom input
 */
async function showDatePicker(currentDue?: string): Promise<Date | undefined> {
    interface DateQuickPickItem extends QuickPickItem {
        date?: Date
    }

    const datePresetItems: DateQuickPickItem[] = DATE_PRESETS.map(preset => ({
        label: preset.label,
        description: formatDateDescription(preset.getValue()),
        date: preset.getValue(),
        alwaysShow: true,
    } as DateQuickPickItem))

    const customDateItem: QuickPickItem = {
        label: 'Custom Date',
        description: 'Enter a custom date (YYYY-MM-DD or MM/DD/YYYY)',
        alwaysShow: true,
    }

    const items: (DateQuickPickItem | QuickPickItem)[] = [...datePresetItems, customDateItem]

    const picked = await window.showQuickPick(items, {
        placeHolder: 'Select or enter a due date',
        matchOnDescription: true,
    })

    if (!picked) {
        return undefined
    }

    const pickedWithDate = picked as DateQuickPickItem
    if (pickedWithDate.date) {
        return pickedWithDate.date
    }

    // Handle custom date input
    const customDateStr = await window.showInputBox({
        prompt: 'Enter date in YYYY-MM-DD or MM/DD/YYYY format',
        placeHolder: '2025-10-25 or 10/25/2025',
        ignoreFocusOut: true,
    })

    if (!customDateStr) {
        return undefined
    }

    const parsedDate = parseCustomDate(customDateStr)
    if (!parsedDate) {
        window.showErrorMessage('Invalid date format. Please use YYYY-MM-DD or MM/DD/YYYY')
        return showDatePicker(currentDue) // Recursively ask again
    }

    return parsedDate
}

/**
 * Show time picker with quick presets and custom input
 */
async function showTimePicker(currentDue?: string): Promise<{ hours: number; minutes: number } | undefined> {
    interface TimeQuickPickItem extends QuickPickItem {
        time?: { hours: number; minutes: number }
    }

    const timePresetItems: TimeQuickPickItem[] = TIME_PRESETS.map(preset => ({
        label: preset.label,
        time: { hours: preset.hours, minutes: preset.minutes },
        alwaysShow: true,
    } as TimeQuickPickItem))

    const customTimeItem: QuickPickItem = {
        label: 'Custom Time',
        description: 'Enter a custom time (e.g., 2:30 PM or 14:30)',
        alwaysShow: true,
    }

    const noTimeItem: TimeQuickPickItem = {
        label: 'No specific time',
        description: 'All day (midnight UTC)',
        time: { hours: 0, minutes: 0 },
        alwaysShow: true,
    } as TimeQuickPickItem

    const items: (TimeQuickPickItem | QuickPickItem)[] = [...timePresetItems, customTimeItem, noTimeItem]

    const picked = await window.showQuickPick(items, {
        placeHolder: 'Select a time for the task',
        matchOnDescription: true,
    })

    if (!picked) {
        return undefined
    }

    const pickedWithTime = picked as TimeQuickPickItem
    if (pickedWithTime.time !== undefined) {
        return pickedWithTime.time
    }

    // Handle custom time input
    const customTimeStr = await window.showInputBox({
        prompt: 'Enter time (e.g., 2:30 PM, 14:30, or 9 AM)',
        placeHolder: '2:30 PM',
        ignoreFocusOut: true,
    })

    if (!customTimeStr) {
        return undefined
    }

    const parsedTime = parseCustomTime(customTimeStr)
    if (!parsedTime) {
        window.showErrorMessage('Invalid time format. Please use 12-hour (2:30 PM) or 24-hour (14:30) format')
        return showTimePicker(currentDue) // Recursively ask again
    }

    return parsedTime
}

/**
 * Show recurring pattern picker
 */
async function showRecurringPicker(currentRecurring?: string): Promise<string | undefined> {
    const items = RECURRING_PRESETS.map(preset => ({
        label: preset.label,
        detail: preset.value ? `Pattern: ${preset.value}` : 'One-time task',
        recurringValue: preset.value,
    }))

    const picked = await window.showQuickPick(items, {
        placeHolder: 'Select recurrence pattern (optional)',
        matchOnDescription: true,
    })

    if (!picked) {
        return undefined
    }

    return picked.recurringValue
}

/**
 * Format date for quick pick description
 */
function formatDateDescription(date: Date): string {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const compareDate = new Date(date)
    compareDate.setHours(0, 0, 0, 0)

    const daysFromNow = Math.floor((compareDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    if (daysFromNow === 0) {
        return 'Today'
    } else if (daysFromNow === 1) {
        return 'Tomorrow'
    } else if (daysFromNow > 1 && daysFromNow <= 7) {
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' })
        return `${dayName} (${daysFromNow} days from now)`
    } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
}

/**
 * Simple confirmation dialog for clearing schedule
 */
export async function confirmClearSchedule(): Promise<boolean> {
    const result = await window.showWarningMessage(
        'Clear this task schedule?',
        { modal: true },
        'Clear',
        'Cancel'
    )
    return result === 'Clear'
}
