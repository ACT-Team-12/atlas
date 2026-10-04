package com.stephensookra.atlas.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Share
import android.content.Intent
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stephensookra.atlas.AppModel
import com.stephensookra.atlas.data.Barrier
import com.stephensookra.atlas.data.PaperFirst
import com.stephensookra.atlas.data.PlanResponse
import com.stephensookra.atlas.data.PlanStep
import com.stephensookra.atlas.data.ResourceCard
import com.stephensookra.atlas.data.ShareText
import com.stephensookra.atlas.data.VerifiedItem
import com.stephensookra.atlas.data.nonEmpty
import java.text.NumberFormat
import java.util.Locale

@Composable
fun PlanScreen(model: AppModel) {
    val speaker = rememberSpeaker()
    var reminder by remember { mutableStateOf<ReminderTarget?>(null) }
    var confirmClear by remember { mutableStateOf(false) }
    val plan = model.plan
    if (plan == null) {
        ScreenBody { Text("No plan yet.", style = Type.body) }
        return
    }
    // Every grounded step the plan could point at, removed or not: a plan step's paper quote never drops out.
    val planItems = model.care?.items.orEmpty().filter { it.grounded }
    val outdated = model.planOutdated
    LaunchedEffect(outdated) { if (outdated) speaker.stop() }
    ScreenBody {
        ScreenTitle("Your plan", plan.located.label)
        MedicalNote()
        if (outdated) {
            OutdatedNote(
                when {
                    model.careProvenanceUnknown || model.planProvenanceUnknown ->
                        "This plan was saved by an older version of ATLAS, which did not keep what it was made from. " +
                            (if (model.careOutdated) "Read your paper again first" else "Update the plan") +
                            "; until then reading aloud, sharing and reminders are off."
                    model.careOutdated -> "You changed your paper's text, language or reading level since this plan was made. Read your paper again first; until then reading aloud, sharing and reminders are off."
                    else -> "You changed your steps, barriers, language, note or place since this plan was made. Update the plan; until then reading aloud, sharing and reminders are off."
                }
            )
            if (!model.careOutdated) PillButton("Update the plan", onClick = { speaker.stop(); model.makePlan() },
                fill = Palette.ink, textColor = Palette.paper, shadow = Palette.mint)
        }
        if (model.hasWarnings) WarningBanner()
        Text(PaperFirst.PLAN_IS_A_SUGGESTION, style = Type.caption)
        Text(plan.summary, style = Type.title3.copy(fontWeight = FontWeight.SemiBold, fontSize = 19.sp))
        // The plan is a suggestion and never certified: each step is followed by the paper's own words for it.
        // Off while outdated, like the website: the plan was built in a language that may no longer be the one picked.
        if (!outdated) ReadAloudBar(speaker, model.language, PaperFirst.planSpeechLines(plan, planItems))
        val context = LocalContext.current
        if (!outdated) OutlinePill("Send to family", onClick = {
            val text = ShareText.plan(model.items, plan, model.care?.let(PaperFirst::readingGeneralQuestions).orEmpty(), model.meaning, planItems)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, ShareText.TITLE)
                putExtra(Intent.EXTRA_TEXT, text)
            }
            context.startActivity(Intent.createChooser(send, "Send the plan to family"))
        }, fill = Palette.mint, icon = Icons.Filled.Share,
            contentDescription = "Send to family. Opens the share sheet to text or email the plan. ATLAS does not see or keep it.")
        Text("Send to family goes from your own phone. ATLAS doesn't see or keep it.", style = Type.caption.copy(fontWeight = FontWeight.Normal))
        Text(
            "${plan.stats.steps} steps · ${plan.stats.candidates} verified options checked · ${plan.stats.dropped_refs} unverified suggestions removed",
            style = Type.foot.copy(fontWeight = FontWeight.Bold),
        )

        if (plan.ask_a_person) {
            AtlasCard(background = Palette.peach, border = Palette.peachDeep) {
                Text("This needs a person too", style = Type.headline.copy(color = Palette.peachDeep))
                Text("${plan.ask_a_person_reason} Call 211 or your community health worker.", style = Type.sub)
                CallButton("Call 211", "211")
            }
        }

        plan.steps.forEachIndexed { i, step ->
            val quotes = PaperFirst.planStepQuotes(step, planItems)
            PlanStepCard(i + 1, step, plan, quotes, remindEnabled = !outdated) {
                // A plan step is the AI's suggestion: the reminder says so, and carries the paper's words.
                reminder = ReminderTarget("Step ${i + 1} of your plan", quotes.firstOrNull() ?: "",
                    "Suggestion from ATLAS, not the paper: ${step.title}. ${step.action}")
            }
        }

        // Paper first (PaperFirst.visitQuestions): a step's own question only when certified.
        val questions = PaperFirst.visitQuestions(model.items.filter { it.grounded }, model.care?.let(PaperFirst::readingGeneralQuestions).orEmpty(), model.removedItems) { model.checkFor(it) }
        if (questions.isNotEmpty()) {
            AtlasCard {
                Text("Questions for your next visit", style = Type.title3)
                questions.forEach { Text("? $it", style = Type.sub.copy(fontWeight = FontWeight.Normal)) }
            }
        }

        Text(
            "ATLAS explains your own paperwork and points to verified public resources. It is not medical advice. Model: ${plan.model}.",
            style = Type.caption.copy(fontWeight = FontWeight.Normal),
        )
        OutlinePill("Clear from this phone", onClick = { confirmClear = true })
    }
    reminder?.let { ReminderDialog(it) { reminder = null } }
    if (confirmClear) ConfirmClearDialog(onConfirm = { confirmClear = false; model.clearFromPhone() }, onDismiss = { confirmClear = false })
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PlanStepCard(index: Int, step: PlanStep, plan: PlanResponse, quotes: List<String>, remindEnabled: Boolean, onRemind: () -> Unit) {
    AtlasCard {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top,
            modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "Step $index: ${step.title}"; heading() }) {
            Text("$index", style = Type.screenTitle.copy(color = Palette.teal, fontSize = 28.sp))
            Text(step.title, style = Type.title3)
        }
        if (step.barrier.isNotEmpty()) Chip(Barrier.of(step.barrier)?.label ?: step.barrier, Palette.mintSoft, Palette.ink)
        Text(step.action, style = Type.body.copy(fontWeight = FontWeight.SemiBold))
        if (step.why.isNotEmpty()) Text("Why: ${step.why}", style = Type.sub.copy(fontWeight = FontWeight.Normal, color = Palette.inkSoft))
        quotes.forEach { q ->
            Text("Your paper says: “$q”", style = Type.sub.copy(color = Palette.ink),
                modifier = Modifier.sunRule().semantics { contentDescription = "Your paper says: $q" })
        }
        if (remindEnabled) OutlinePill("Remind me", onClick = onRemind, fill = Palette.mint, icon = Icons.Filled.Notifications,
            contentDescription = "Remind me about step $index")
        // Who picked these places: ATLAS, not the paper (caregiver's try, Oct 4; web lib/provenance.ts).
        if (step.resource_ids.any { plan.resources[it] != null }) {
            Text("Suggested by ATLAS, not from your paper", style = Type.sub.copy(fontWeight = FontWeight.Bold, color = Palette.inkSoft))
        }
        step.resource_ids.forEach { id -> plan.resources[id]?.let { ResourceView(it) } }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ResourceView(card: ResourceCard) {
    val context = LocalContext.current
    when (card) {
        is ResourceCard.ClinicCard -> {
            val c = card.clinic
            AtlasCard(background = Palette.mintSoft, border = Palette.ink.copy(alpha = 0.8f), lineWidth = 2.dp) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("Health center")
                    card.km?.let { Text(String.format(Locale.US, "%.1f km away", it), style = Type.caption) }
                }
                Text(c.name, style = Type.headline)
                Text("${c.address}, ${c.city} ${c.zip}", style = Type.sub.copy(color = Palette.inkSoft))
                Text("Fees adjust to your income and family size (federal health center rule).", style = Type.sub)
                c.nearest_rail?.let {
                    IconLine(Icons.Filled.Place, "${it.name}, ${String.format(Locale.US, "%.1f", it.meters / 1000)} km straight-line")
                }
                c.nearest_bus?.let { IconLine(Icons.Filled.LocationOn, "Bus stop: ${it.name}") }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    // The server sends "" for a missing phone; never show a Call button with nothing to call.
                    c.phone.nonEmpty()?.let { if (Links.tel(it) != null) CallButton("Call $it", it) }
                    OutlinePill("Transit directions", onClick = { Links.directions(context, c) }, icon = Icons.Filled.Place,
                        contentDescription = "Transit directions to ${c.name}. Opens Google Maps")
                    Links.web(c.website.nonEmpty())?.let { url ->
                        OutlinePill("Website", onClick = { Links.openInApp(context, url) }, contentDescription = "${c.name} website")
                    }
                }
                val hours = c.hours_per_week?.let { "${NumberFormat.getNumberInstance(Locale.US).format(it)} hrs/week listed" } ?: "hours not listed"
                Text("Source: HRSA health center data · $hours", style = Type.caption.copy(fontWeight = FontWeight.Normal, fontSize = 11.sp))
            }
        }
        is ResourceCard.ProgramCard -> {
            val p = card.program
            AtlasCard(background = Palette.sky.copy(alpha = 0.5f), border = Palette.ink.copy(alpha = 0.8f), lineWidth = 2.dp) {
                Chip("Program", Palette.sky, Palette.skyDeep)
                Text(p.name, style = Type.headline)
                Text("“${p.evidence_quote}”",
                    style = Type.foot.copy(fontStyle = FontStyle.Italic, fontWeight = FontWeight.Normal), modifier = Modifier.sunRule())
                val phone = p.access.phone.nonEmpty()?.takeIf { Links.tel(it) != null }
                val url = Links.web(p.access.url.nonEmpty())
                if (phone != null || url != null) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        phone?.let { CallButton("Call $it", it) }
                        url?.let { OutlinePill("Open", onClick = { Links.openInApp(context, it) }, contentDescription = "Open ${p.name} website") }
                    }
                }
                p.access.text.nonEmpty()?.let { Text(it, style = Type.sub.copy(fontWeight = FontWeight.Normal)) }
                Links.web(p.source_url)?.let { src ->
                    Links.host(src)?.let { host ->
                        TextLink("Verified on the official page: $host", onClick = { Links.openInApp(context, src) }, color = Palette.inkSoft)
                    }
                }
            }
        }
    }
}

@Composable
private fun IconLine(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        androidx.compose.material3.Icon(icon, contentDescription = null, tint = Palette.inkSoft)
        Text(text, style = Type.sub.copy(fontWeight = FontWeight.Normal))
    }
}

@Composable
fun CallButton(label: String, number: String) {
    val context = LocalContext.current
    OutlinePill(label, onClick = { Links.dial(context, number) }, fill = Palette.ink, textColor = Palette.paper,
        icon = Icons.Filled.Phone, contentDescription = label)
}

