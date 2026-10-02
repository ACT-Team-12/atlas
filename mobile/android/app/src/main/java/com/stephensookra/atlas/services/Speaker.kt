package com.stephensookra.atlas.services

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import com.stephensookra.atlas.data.Language
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale

/** Read aloud with the phone's own voices. One utterance per line so it pauses between steps. */
class Speaker(context: Context) {
    companion object {
        /** Same map as SPEECH_LANG in web/src/ui/CarePlanTool.tsx and the iOS app. */
        val voiceCode: Map<Language, String> = mapOf(
            Language.English to "en-US", Language.Spanish to "es-US", Language.Vietnamese to "vi-VN",
            Language.Korean to "ko-KR", Language.Chinese to "zh-CN", Language.Amharic to "am-ET",
            Language.French to "fr-FR",
        )

        fun code(language: Language): String = voiceCode[language] ?: "en-US"

        fun missingVoiceNote(language: Language) =
            "This phone has no ${language.name} voice installed, so it reads with its default voice. " +
                "You can add voices in Settings, Accessibility, Text-to-speech."

        const val NO_ENGINE_NOTE =
            "This phone has no text-to-speech voice set up. You can add one in Settings, Accessibility, Text-to-speech."
    }

    private val _speaking = MutableStateFlow(false)
    val speaking: StateFlow<Boolean> = _speaking.asStateFlow()

    /** Set when the phone has no voice for the chosen language, so the screen can say so. */
    private val _note = MutableStateFlow<String?>(null)
    val note: StateFlow<String?> = _note.asStateFlow()

    private var ready = false
    private var failed = false
    private var queued: Pair<List<String>, Language>? = null
    private var lastId: String? = null
    private var generation = 0

    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) {
            ready = true
            queued?.let { (lines, lang) -> queued = null; speak(lines, lang) }
        } else {
            failed = true
            _note.value = NO_ENGINE_NOTE
            _speaking.value = false
        }
    }

    init {
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) {
                if (utteranceId != null && utteranceId == lastId) _speaking.value = false
            }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                if (utteranceId == lastId) _speaking.value = false
            }
            override fun onStop(utteranceId: String?, interrupted: Boolean) {
                // A late callback from an earlier, stopped reading must not hide the new Stop button.
                if (utteranceId != null && utteranceId.startsWith("atlas-$generation-")) _speaking.value = false
            }
        })
    }

    fun speak(lines: List<String>, language: Language) {
        stop()
        if (failed) {
            _note.value = NO_ENGINE_NOTE
            return
        }
        val clean = lines.map { it.trim() }.filter { it.isNotEmpty() }
        if (clean.isEmpty()) return
        _speaking.value = true
        if (!ready) {
            queued = clean to language
            return
        }
        val result = tts.setLanguage(Locale.forLanguageTag(code(language)))
        _note.value = if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            tts.language = Locale.getDefault()
            missingVoiceNote(language)
        } else null
        tts.setSpeechRate(0.95f)
        generation += 1
        clean.forEachIndexed { i, line ->
            val id = "atlas-$generation-$i"
            tts.speak(line, TextToSpeech.QUEUE_ADD, null, id)
            tts.playSilentUtterance(250, TextToSpeech.QUEUE_ADD, "$id-pause")
            lastId = "$id-pause"
        }
        Log.i("AtlasSpeaker", "Speaking ${clean.size} lines in ${code(language)}")
    }

    fun stop() {
        queued = null
        lastId = null
        if (ready) tts.stop()
        _speaking.value = false
    }

    fun shutdown() {
        stop()
        tts.shutdown()
    }
}
