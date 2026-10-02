package com.stephensookra.atlas.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// Kotlin mirrors of the server types. Source of truth:
//   web/src/lib/schema.ts     (CarePlanResponse, VerifiedItem, RequestSchema)
//   web/src/lib/plan.ts       (PlanRequestSchema, PlanResponse, PlanStep, ResourceCard)
//   web/src/lib/resources.ts  (Clinic, Program, BARRIERS)
// Unknown keys are ignored, and fields the server fills with zod defaults decode leniently.

/** One Json config for the whole app. `explicitNulls = false` omits a null zip or location,
 *  because the server's zod schema accepts a missing field but rejects null. */
val AtlasJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
    encodeDefaults = true
}

enum class ItemKind { medication, lab_test, referral, follow_up_visit, self_care, warning_sign;
    companion object {
        fun of(raw: String): ItemKind? = entries.firstOrNull { it.name == raw }
    }
}

@Serializable
enum class ReadingLevel { simple, standard, detailed }

@Serializable
enum class Language { English, Spanish, Vietnamese, Korean, Chinese, Amharic, French }

/** Mirrors BARRIERS + BARRIER_LABEL in web/src/lib/resources.ts, in the same order. */
@Serializable
enum class Barrier(val label: String) {
    transport("Getting there (no car, long bus ride)"),
    cost("Paying for the visit, lab or medicine"),
    insurance("No insurance, or not sure what's covered"),
    language("I'd rather get help in another language"),
    schedule("Time off work, clinic hours"),
    tech("No reliable phone or internet"),
    referrals("Not sure how referrals or labs work"),
    food("Having enough food"),
    housing("A safe, steady place to stay");

    companion object {
        fun of(raw: String): Barrier? = entries.firstOrNull { it.name == raw }
    }
}

// ---------- /api/extract ----------

@Serializable
data class ExtractRequest(
    val text: String,
    val reading_level: ReadingLevel,
    val language: Language,
)

@Serializable
data class TextSpan(val start: Int, val end: Int)

@Serializable
data class VerifiedItem(
    val id: String,
    val kind: String,
    val title: String,
    val plain_language: String,
    val why: String = "",
    val `when`: String = "",
    val source_quote: String,
    val needs_clarification: Boolean = false,
    val question_for_clinic: String = "",
    val grounded: Boolean = false,
    val span: TextSpan? = null,
) {
    val itemKind: ItemKind? get() = ItemKind.of(kind)
}

@Serializable
data class CareStats(val extracted: Int, val grounded: Int, val refused: Int, val ms: Int)

@Serializable
data class CarePlanResponse(
    val source_text: String = "",
    val source_kind: String = "text",
    val items: List<VerifiedItem>,
    val refused: List<VerifiedItem> = emptyList(),
    val questions_for_doctor: List<String> = emptyList(),
    val not_in_document: List<String> = emptyList(),
    val has_warning_signs: Boolean = false,
    val model: String = "",
    val stats: CareStats,
)

// ---------- /api/plan ----------

@Serializable
data class PlanCareInput(
    val id: String,
    val kind: String,
    val title: String,
    val plain_language: String,
    val `when`: String,
    val source_quote: String,
) {
    constructor(item: VerifiedItem) : this(item.id, item.kind, item.title, item.plain_language, item.`when`, item.source_quote)
}

@Serializable
data class LatLng(val lat: Double, val lng: Double) {
    /** The server accepts the US and its territories (PlanRequestSchema: lat -20 to 72, lng -180 to 180). */
    val isInServiceArea: Boolean get() = lat in -20.0..72.0 && lng in -180.0..180.0
}

@Serializable
data class PlanRequest(
    val care: List<PlanCareInput>,
    val barriers: List<Barrier>,
    val zip: String? = null,
    val location: LatLng? = null,
    val language: Language,
    val note: String,
)

@Serializable
data class PlanStep(
    val title: String,
    val action: String = "",
    val why: String = "",
    val barrier: String = "",
    val care_ids: List<String> = emptyList(),
    val resource_ids: List<String> = emptyList(),
    val dropped_refs: List<String> = emptyList(),
)

@Serializable
data class TransitStop(val name: String, val stop_id: String, val meters: Double)

@Serializable
data class Clinic(
    val id: String,
    val name: String,
    val address: String,
    val city: String,
    val zip: String,
    val phone: String,
    val lat: Double,
    val lng: Double,
    // Extra detail only; optional so a missing field never drops a verified clinic.
    val org: String? = null,
    val county: String? = null,
    val website: String? = null,
    val hours_per_week: Double? = null,
    val setting: String? = null,
    val health_center_type: String? = null,
    val nearest_rail: TransitStop? = null,
    val nearest_bus: TransitStop? = null,
    val barriers: List<String>? = null,
    val source_id: String? = null,
)

@Serializable
data class ProgramAccess(val phone: String? = null, val text: String? = null, val url: String? = null)

@Serializable
data class Program(
    val id: String,
    val name: String,
    val barriers: List<String>? = null,
    val access: ProgramAccess,
    val languages: List<String>? = null,
    val evidence_quote: String,
    val source_url: String,
    val source_id: String? = null,
    val hours_note: String? = null,
    val language_note: String? = null,
)

/** Discriminated union on "type", like the TypeScript ResourceCard. */
@Serializable
sealed class ResourceCard {
    abstract val id: String

    @Serializable
    @SerialName("clinic")
    data class ClinicCard(override val id: String, val km: Double? = null, val clinic: Clinic) : ResourceCard()

    @Serializable
    @SerialName("program")
    data class ProgramCard(override val id: String, val program: Program) : ResourceCard()
}

@Serializable
data class Located(val by: String, val label: String)

@Serializable
data class PlanStats(val candidates: Int, val steps: Int, val dropped_refs: Int, val ms: Int)

@Serializable
data class PlanResponse(
    val summary: String,
    val steps: List<PlanStep>,
    val resources: Map<String, ResourceCard>,
    val ask_a_person: Boolean = false,
    val ask_a_person_reason: String = "",
    val located: Located,
    val stats: PlanStats,
    val model: String = "",
)

// /api/results (web/src/lib/results.ts)

@Serializable
data class ResultsRequest(val text: String, val language: Language)

/** One test on the report. status is decided by the server's code from the printed flag or range, never by the AI. */
@Serializable
data class ResultRow(
    val test: String,
    val value: String,
    val unit: String = "",
    val range_text: String = "",
    val quote: String,
    val plain_name: String = "",
    val ask: String = "",
    val status: String, // "outside" | "inside" | "unknown"
    val direction: String? = null, // "high" | "low"
    val reason: String = "",
)

@Serializable
data class ResultsCounts(val outside: Int, val inside: Int, val unknown: Int)

@Serializable
data class ResultsDropped(val test: String, val reason: String)

/** How many result-looking lines the server's code found, and how many a verified row covered. */
@Serializable
data class ResultsCoverage(val candidates: Int, val checked: Int, val unchecked: List<String> = emptyList())

@Serializable
data class ResultsResponse(
    val rows: List<ResultRow>,
    val dropped: List<ResultsDropped> = emptyList(),
    val counts: ResultsCounts,
    /** Null from an older server; then the app never claims an all-clear. */
    val coverage: ResultsCoverage? = null,
    val model: String = "",
    val ms: Int = 0,
) {
    /** Same rules as headline() in web/src/ui/LabResults.tsx: never a report-wide all-clear without full coverage. */
    val headline: String get() {
        if (rows.isEmpty()) return "We couldn't read any results from this. Check the text or ask your clinic."
        if (counts.outside > 0) return "${counts.outside} ${if (counts.outside == 1) "result is" else "results are"} outside the range on your report."
        val c = coverage ?: return "None of the results we read is outside its range. Check the rest of your report too."
        if (c.checked < c.candidates) return "We checked ${c.checked} of ${c.candidates} result lines. None of the ones we checked is outside its range."
        if (counts.unknown > 0) return "Nothing is marked outside its range, but we couldn't tell for ${counts.unknown} ${if (counts.unknown == 1) "result" else "results"}."
        return "Nothing on this report is marked or printed as outside its range."
    }
}

@Serializable
data class ApiErrorBody(val error: String = "")

/** null for null, "" or whitespace, matching how the web treats empty strings as absent. */
fun String?.nonEmpty(): String? = this?.trim()?.takeIf { it.isNotEmpty() }
