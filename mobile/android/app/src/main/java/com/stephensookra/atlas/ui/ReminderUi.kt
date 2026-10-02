package com.stephensookra.atlas.ui

import android.Manifest
import android.app.TimePickerDialog
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.stephensookra.atlas.services.ReminderDraft
import com.stephensookra.atlas.services.Reminders
import com.stephensookra.atlas.services.StoredReminder
import java.text.DateFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Date

/** Date and time picker that schedules one local notification. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReminderDialog(target: ReminderTarget, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val zone = ZoneId.systemDefault()
    val start = remember { java.time.ZonedDateTime.now(zone).plusHours(1) }
    val today = remember { LocalDate.now(zone) }
    // Material's date picker works in UTC midnights; convert to and from the local calendar day.
    val dateState = rememberDatePickerState(
        initialSelectedDateMillis = start.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                !Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate().isBefore(today)
            override fun isSelectableYear(year: Int): Boolean = year >= today.year
        },
    )
    var hour by remember { mutableStateOf(start.hour) }
    var minute by remember { mutableStateOf(start.minute) }
    var message by remember { mutableStateOf<String?>(null) }

    val chosenDay = dateState.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() } ?: start.toLocalDate()
    val draft = ReminderDraft(target.title, target.quote, ReminderDraft.millisFor(chosenDay, hour, minute, zone), target.detail)

    fun save() {
        val problem = Reminders.schedule(context, draft)
        if (problem == null) onDismiss() else message = problem
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) save() else message = "Without notification permission ATLAS cannot remind you. You can turn it on in Settings."
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Palette.mintSoft).safeDrawingPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                TextButton(onClick = onDismiss) { Text("Cancel", color = Palette.tealDeep) }
            }
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                ScreenTitle("Remind me", target.title)
                val colors = DatePickerDefaults.colors(
                    containerColor = Palette.paper, selectedDayContainerColor = Palette.teal, todayDateBorderColor = Palette.teal,
                    todayContentColor = Palette.tealDeep,
                )
                AtlasCard(lineWidth = 2.dp) {
                    Text("Day", style = Type.sub.copy(fontWeight = FontWeight.Bold))
                    DatePicker(state = dateState, colors = colors, title = null, headline = null, showModeToggle = false,
                        modifier = Modifier.semantics { contentDescription = "Reminder date" })
                    Text("Time", style = Type.sub.copy(fontWeight = FontWeight.Bold))
                    // The system time dialog: a familiar clock face with a keyboard option, same on every phone.
                    val timeText = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(draft.atMillis))
                    OutlinePill("$timeText  \u00B7  Change", onClick = {
                        TimePickerDialog(context, { _, h, m -> hour = h; minute = m }, hour, minute,
                            android.text.format.DateFormat.is24HourFormat(context)).show()
                    }, fill = Palette.mint, contentDescription = "Reminder time $timeText. Change time")
                }
                AtlasCard(background = Palette.mintSoft) {
                    Text("Your reminder will say", style = Type.caption.copy(fontWeight = FontWeight.ExtraBold))
                    Text(draft.notificationTitle, style = Type.sub.copy(fontWeight = FontWeight.ExtraBold))
                    Text(draft.notificationBody, style = Type.sub.copy(fontWeight = FontWeight.Normal))
                }
                Text("Reminders live on this phone and work without internet.", style = Type.foot)
                message?.let { Text(it, style = Type.sub.copy(fontWeight = FontWeight.Bold, color = Palette.peachDeep)) }
                PillButton("Set reminder", onClick = {
                    if (Build.VERSION.SDK_INT >= 33 && !Reminders.notificationsAllowed(context)) {
                        permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        save()
                    }
                })
                Spacer(Modifier.padding(8.dp))
            }
        }
    }
}

/** Every ATLAS reminder still waiting to go off, with delete. */
@Composable
fun RemindersListScreen() {
    val context = LocalContext.current
    val pending = remember { mutableStateListOf<StoredReminder>() }
    var loaded by remember { mutableStateOf(false) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            val now = System.currentTimeMillis()
            pending.clear()
            pending.addAll(Reminders.pending(context).filter { it.atMillis > now - 60_000 })
            loaded = true
        }
    }
    ScreenBody {
        if (loaded && pending.isEmpty()) {
            Text("No reminders yet. Tap “Remind me” on any step.", style = Type.sub.copy(color = Palette.inkSoft))
        }
        pending.toList().forEach { r ->
            AtlasCard(lineWidth = 2.dp) {
                Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(r.atMillis)),
                    style = Type.caption.copy(fontWeight = FontWeight.ExtraBold, color = Palette.tealDeep))
                Text(r.title, style = Type.sub.copy(fontWeight = FontWeight.ExtraBold))
                Text(r.body, style = Type.foot.copy(fontWeight = FontWeight.Normal))
                OutlinePill("Delete", onClick = {
                    Reminders.remove(context, listOf(r.id))
                    pending.remove(r)
                }, contentDescription = "Delete reminder: ${r.title}")
            }
        }
        Text("Reminders are stored on this phone only.", style = Type.foot)
    }
}
