package com.stephensookra.atlas.data

import kotlinx.serialization.Serializable

// /api/meaning: the second-model double-check. Source of truth: web/src/lib/meaning.ts (MeaningRequestSchema,
// MeaningResult, MeaningResponse) and web/src/lib/meaningRun.ts (what the browser sends).

@Serializable
data class MeaningItem(val id: String, val plain_language: String, val `when`: String, val source_quote: String)

@Serializable
data class MeaningRequest(val language: Language? = null, val items: List<MeaningItem>) {
    companion object {
        /** The server accepts 1 to 40 items; meaningRun.ts sends the first 40. */
        const val MAX_ITEMS = 40

        /** Same body as runMeaningCheck: the title is checked with the explanation (round 13). Null when there is nothing to check. */
        fun of(items: List<VerifiedItem>, language: Language?): MeaningRequest? {
            if (items.isEmpty()) return null
            return MeaningRequest(language, items.take(MAX_ITEMS).map {
                MeaningItem(it.id, PaperFirst.checkedText(it.title, it.plain_language), it.`when`, it.source_quote)
            })
        }
    }
}

@Serializable
data class MeaningResult(
    val id: String,
    val flagged: Boolean = false,
    val numbers_ok: Boolean = false,
    val unexpected_numbers: List<String> = emptyList(),
    val model_verdict: String = "unclear",
    val what_differs: String = "",
    /** True only when the second model said "same" AND every number checks out. Only this earns the green check. */
    val certified: Boolean = false,
)

@Serializable
data class MeaningResponse(val results: List<MeaningResult>, val flagged: Int = 0, val checker_model: String = "", val ms: Int = 0)

enum class MeaningStatus { idle, loading, done, error }

/** The double-check as the screen has it. `byId` is only read when status is done. */
@Serializable
data class MeaningState(val status: MeaningStatus = MeaningStatus.idle, val byId: Map<String, MeaningResult> = emptyMap()) {
    /** The check for one step. Anything but a finished check is unchecked, so the paper's words lead. */
    fun checkFor(id: String): Check = if (status == MeaningStatus.done) PaperFirst.checkOf(byId[id]) else Check.unchecked

    companion object {
        val IDLE = MeaningState()

        /** Results for ids that were not in the request are dropped, so a reply can never vouch for another step. */
        fun done(request: MeaningRequest, response: MeaningResponse): MeaningState {
            val asked = request.items.associateBy { it.id }
            return MeaningState(MeaningStatus.done, response.results.filter { it.id in asked }.associateBy { it.id })
        }
    }
}
