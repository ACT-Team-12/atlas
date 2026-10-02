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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import com.stephensookra.atlas.data.PlanResponse
import com.stephensookra.atlas.data.PlanStep
import com.stephensookra.atlas.data.ResourceCard
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
    val careById = model.careById
    ScreenBody {
        ScreenTitle("Your plan", plan.located.label)
        MedicalNote()
        if (model.care?.has_warning_signs == true) WarningBanner()
        Text(plan.summary, style = Type.title3.copy(fontWeight = FontWeight.SemiBold, fontSize = 19.sp))
        ReadAloudBar(speaker, model.language, listOf(plan.summary) + plan.steps.mapIndexed { i, s -> "${i + 1}. ${s.title}. ${s.action}" })
        Text(
            "${plan.stats.steps} steps · ${plan.stats.candidates} verified options checked · ${plan.stats.dropped_refs} unverified suggestions removed",
            style = Type.foot.copy(fontWeight = FontWeight.Bold),
        )

        if (plan.ask_a_person) {
            AtlasCard(background = Palette.peach, border = Palette.peachDeep) {
                Text("This needs a person too", style = Type.headline.copy(color = Palette.peachDeep))
                Text("${plan.ask_a_person_reason} Call 211 (United Way of Greater Atlanta) or your community health worker.", style = Type.sub)
                CallButton("Call 211", "211")
            }
        }

        plan.steps.forEachIndexed { i, step ->
            PlanStepCard(i + 1, step, plan, careById) {
                val quote = step.care_ids.firstNotNullOfOrNull { careById[it]?.source_quote } ?: ""
                reminder = ReminderTarget(step.title, quote, step.action)
            }
        }

        val questions = model.care?.questions_for_doctor.orEmpty()
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
fun PlanStepCard(index: Int, step: PlanStep, plan: PlanResponse, careById: Map<String, VerifiedItem>, onRemind: () -> Unit) {
    AtlasCard {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top,
            modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "Step $index: ${step.title}"; heading() }) {
            Text("$index", style = Type.screenTitle.copy(color = Palette.teal, fontSize = 28.sp))
            Text(step.title, style = Type.title3)
        }
        if (step.barrier.isNotEmpty()) Chip(Barrier.of(step.barrier)?.label ?: step.barrier, Palette.mintSoft, Palette.ink)
        Text(step.action, style = Type.body.copy(fontWeight = FontWeight.SemiBold))
        if (step.why.isNotEmpty()) Text("Why: ${step.why}", style = Type.sub.copy(fontWeight = FontWeight.Normal, color = Palette.inkSoft))
        step.care_ids.forEach { id ->
            careById[id]?.let { item ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(item.title, style = Type.caption.copy(color = Palette.ink))
                    PaperQuote(item.source_quote)
                }
            }
        }
        OutlinePill("Remind me", onClick = onRemind, fill = Palette.mint, icon = Icons.Filled.Notifications,
            contentDescription = "Remind me about ${step.title}")
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

