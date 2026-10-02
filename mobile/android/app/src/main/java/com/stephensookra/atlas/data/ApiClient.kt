package com.stephensookra.atlas.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import kotlin.coroutines.cancellation.CancellationException

/** A problem to show the person, already in plain words. */
class ApiException(message: String) : Exception(message)

object ApiErrors {
    const val TOO_MANY = "Too many tries, wait a few minutes."
    const val SERVER = "ATLAS had a problem on its side. Try again in a minute."
    const val GENERIC = "Something went wrong. Try again."
    const val OFFLINE = "We could not reach ATLAS. Check your internet connection and try again."
    const val TIMEOUT = "This took too long. Check your connection and try again."
    const val UNREADABLE = "ATLAS sent back something this app could not read. Try again."

    /** Plain words for a server error. 429 has its own wording; otherwise the server's own `error` text. */
    fun from(status: Int, body: String?): String {
        if (status == 429) return TOO_MANY
        val serverText = try {
            body?.let { AtlasJson.decodeFromString(ApiErrorBody.serializer(), it).error }
        } catch (_: Exception) {
            null
        }
        if (!serverText.isNullOrBlank()) return serverText
        if (status >= 500) return SERVER
        return GENERIC
    }
}

/** Talks to the live ATLAS server. Only the text the person confirmed is sent; never a photo. */
class ApiClient(private val baseUrl: String = BASE_URL) {
    companion object {
        const val BASE_URL = "https://atlas-team12.vercel.app"
    }

    suspend fun extract(text: String, level: ReadingLevel, language: Language): CarePlanResponse =
        post("/api/extract", AtlasJson.encodeToString(ExtractRequest.serializer(), ExtractRequest(text, level, language)),
            CarePlanResponse.serializer())

    suspend fun plan(request: PlanRequest): PlanResponse =
        post("/api/plan", AtlasJson.encodeToString(PlanRequest.serializer(), request), PlanResponse.serializer())

    private suspend fun <T> post(path: String, body: String, out: KSerializer<T>): T = coroutineScope {
        val conn = URL(baseUrl + path).openConnection() as HttpURLConnection
        val call = async(Dispatchers.IO) { send(conn, body, out) }
        try {
            call.await()
        } catch (e: CancellationException) {
            // Cancel button: closing the connection unblocks the blocking read right away.
            conn.disconnect()
            throw e
        }
    }

    private suspend fun <T> send(conn: HttpURLConnection, body: String, out: KSerializer<T>): T {
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 20_000
            conn.readTimeout = 90_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
            currentCoroutineContext().ensureActive()
            if (status !in 200..299) throw ApiException(ApiErrors.from(status, text))
            return try {
                AtlasJson.decodeFromString(out, text ?: "")
            } catch (_: SerializationException) {
                throw ApiException(ApiErrors.UNREADABLE)
            } catch (_: IllegalArgumentException) {
                throw ApiException(ApiErrors.UNREADABLE)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            throw e
        } catch (e: SocketTimeoutException) {
            currentCoroutineContext().ensureActive()
            throw ApiException(ApiErrors.TIMEOUT)
        } catch (e: IOException) {
            currentCoroutineContext().ensureActive()
            throw ApiException(ApiErrors.OFFLINE)
        } finally {
            conn.disconnect()
        }
    }
}
