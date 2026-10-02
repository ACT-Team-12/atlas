package com.stephensookra.atlas.services

import android.content.Context
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.tasks.await
import kotlin.math.abs
import kotlin.math.min

/** One recognized line and where it sits on the page (pixels, origin top-left). */
data class OcrLine(val text: String, val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val midY: Float get() = (top + bottom) / 2f
    val height: Int get() = bottom - top
}

/**
 * Reads text from photos on the phone with the bundled ML Kit text recognizer. The model ships inside
 * the app, so this works offline and without Google Play services. Nothing is uploaded.
 */
object TextReader {
    /** Every page, one recognized line per text line, pages separated by a blank line. */
    suspend fun read(context: Context, pages: List<Uri>): String {
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        try {
            val out = mutableListOf<String>()
            for (page in pages) {
                currentCoroutineContext().ensureActive()
                val image = InputImage.fromFilePath(context, page) // applies the photo's EXIF rotation
                val result = recognizer.process(image).await()
                val lines = result.textBlocks.flatMap { b -> b.lines }.mapNotNull { l ->
                    val box = l.boundingBox ?: return@mapNotNull null
                    OcrLine(l.text, box.left, box.top, box.right, box.bottom)
                }
                val text = order(lines).joinToString("\n")
                if (text.isNotBlank()) out += text
            }
            return out.joinToString("\n\n")
        } finally {
            recognizer.close()
        }
    }

    /** Top to bottom, then left to right; pieces on the same visual line are joined with spaces. */
    fun order(lines: List<OcrLine>): List<String> {
        val rows = lines.filter { it.text.isNotBlank() }.sortedBy { it.midY }
        val groups = mutableListOf<MutableList<OcrLine>>()
        for (row in rows) {
            val anchor = groups.lastOrNull()?.first()
            if (anchor != null && abs(anchor.midY - row.midY) < min(anchor.height, row.height) * 0.5f) {
                groups.last() += row
            } else {
                groups += mutableListOf(row)
            }
        }
        return groups.map { g -> g.sortedBy { it.left }.joinToString("   ") { it.text } }
    }
}
