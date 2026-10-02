package com.stephensookra.atlas.services

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.stephensookra.atlas.data.AtlasJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.time.LocalDate
import java.time.ZoneId

/** One reminder the person asked for. Built from a step title plus the exact line from their paper. */
data class ReminderDraft(
    val stepTitle: String,
    /** The exact line from the person's paper. Empty when a plan step cites no care step. */
    val quote: String,
    val atMillis: Long,
    /** Used only when there is no quote, so the reminder never pretends a line came from the paper. */
    val detail: String = "",
) {
    val notificationTitle: String get() = "ATLAS reminder: $stepTitle"

    val notificationBody: String
        get() {
            val q = quote.trim()
            if (q.isNotEmpty()) return "$stepTitle\nFrom your paper: “$q”"
            val d = detail.trim()
            return if (d.isEmpty()) stepTitle else "$stepTitle\n$d"
        }

    companion object {
        /** The chosen calendar day at the chosen hour and minute, in the phone's time zone. */
        fun millisFor(date: LocalDate, hour: Int, minute: Int, zone: ZoneId = ZoneId.systemDefault()): Long =
            date.atTime(hour, minute).atZone(zone).toInstant().toEpochMilli()
    }
}

/** A scheduled reminder, kept in a small JSON file because AlarmManager cannot list what it holds. */
@Serializable
data class StoredReminder(val id: Int, val title: String, val body: String, val atMillis: Long)

class ReminderStore(directory: File) {
    private val file = File(directory, "reminders-v1.json")
    private val serializer = ListSerializer(StoredReminder.serializer())

    @Synchronized
    fun all(): List<StoredReminder> = try {
        if (file.exists()) AtlasJson.decodeFromString(serializer, file.readText()) else emptyList()
    } catch (_: Exception) {
        emptyList()
    }

    @Synchronized
    fun write(list: List<StoredReminder>) {
        if (list.isEmpty()) {
            file.delete()
            return
        }
        file.parentFile?.mkdirs()
        file.writeText(AtlasJson.encodeToString(serializer, list.sortedBy { it.atMillis }))
    }

    @Synchronized
    fun add(r: StoredReminder) = write(all().filter { it.id != r.id } + r)

    @Synchronized
    fun remove(ids: Collection<Int>) = write(all().filter { it.id !in ids })
}

/** Local notifications only. Works with no internet, nothing leaves the phone. */
object Reminders {
    const val TAG = "AtlasReminders"
    const val CHANNEL_ID = "reminders"
    const val EXTRA_ID = "id"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"

    fun store(context: Context) = ReminderStore(context.filesDir)

    fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            val channel = NotificationChannel(CHANNEL_ID, "Reminders", NotificationManager.IMPORTANCE_HIGH)
            channel.description = "Reminders you set for steps from your paper"
            nm.createNotificationChannel(channel)
        }
    }

    fun notificationsAllowed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
    }

    /** Schedules one reminder. Returns a plain-words problem, or null when it is saved. */
    fun schedule(context: Context, draft: ReminderDraft, now: Long = System.currentTimeMillis()): String? {
        if (!notificationsAllowed(context)) {
            return "Notifications are off for ATLAS. Turn them on in Settings to get reminders."
        }
        if (draft.atMillis <= now) return "Pick a time in the future."
        ensureChannel(context)
        val id = (now % Int.MAX_VALUE).toInt() xor draft.hashCode()
        val stored = StoredReminder(id, draft.notificationTitle, draft.notificationBody, draft.atMillis)
        arm(context, stored)
        store(context).add(stored)
        Log.i(TAG, "Scheduled reminder $id for ${draft.atMillis}; pending ATLAS reminders: ${store(context).all().size}")
        return null
    }

    /** Inexact fallback window. Ten minutes is the shortest window Android grants without exact-alarm access;
     *  a plain inexact alarm can drift by up to an hour, which is too loose for a medicine reminder. */
    const val INEXACT_WINDOW_MS = 10 * 60 * 1000L

    /** Exact alarm where Android allows it; otherwise a window alarm that goes off within 10 minutes of the time. */
    fun arm(context: Context, r: StoredReminder) {
        val am = context.getSystemService(AlarmManager::class.java)
        val pi = pendingIntent(context, r) ?: return
        val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.atMillis, pi)
            else am.setWindow(AlarmManager.RTC_WAKEUP, r.atMillis, INEXACT_WINDOW_MS, pi)
        } catch (_: SecurityException) {
            am.setWindow(AlarmManager.RTC_WAKEUP, r.atMillis, INEXACT_WINDOW_MS, pi)
        }
        Log.i(TAG, "Armed reminder ${r.id} at ${r.atMillis} exact=$exact")
    }

    private fun pendingIntent(context: Context, r: StoredReminder, create: Boolean = true): PendingIntent? {
        val intent = Intent(context, ReminderReceiver::class.java)
            .setAction("com.stephensookra.atlas.REMINDER.${r.id}")
            .putExtra(EXTRA_ID, r.id)
            .putExtra(EXTRA_TITLE, r.title)
            .putExtra(EXTRA_BODY, r.body)
        val flags = PendingIntent.FLAG_IMMUTABLE or
            (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE)
        return PendingIntent.getBroadcast(context, r.id, intent, flags)
    }

    fun pending(context: Context): List<StoredReminder> = store(context).all().sortedBy { it.atMillis }

    fun remove(context: Context, ids: Collection<Int>) {
        val am = context.getSystemService(AlarmManager::class.java)
        val all = store(context).all()
        for (r in all.filter { it.id in ids }) {
            pendingIntent(context, r, create = false)?.let { am.cancel(it); it.cancel() }
        }
        store(context).remove(ids)
    }

    fun removeAll(context: Context) = remove(context, store(context).all().map { it.id })

    /** After a restart Android forgets alarms; put them back. Missed ones go off right away. */
    fun rearmAll(context: Context) {
        val now = System.currentTimeMillis()
        for (r in store(context).all()) arm(context, if (r.atMillis > now) r else r.copy(atMillis = now + 5_000))
    }
}
