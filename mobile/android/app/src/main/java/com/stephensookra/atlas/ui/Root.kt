package com.stephensookra.atlas.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.LaunchedEffect
import com.stephensookra.atlas.data.ReadyCue
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.stephensookra.atlas.AppModel
import com.stephensookra.atlas.Busy
import com.stephensookra.atlas.Route

@Composable
fun AtlasRoot(model: AppModel) {
    var showAbout by rememberSaveable { mutableStateOf(false) }
    val route = model.path.lastOrNull()

    // While looking around, Back moves between screens and the read or plan keeps running; on the busy card it cancels.
    BackHandler(enabled = (model.busy == null || model.lookingAround) && route != null) { model.back() }
    BackHandler(enabled = model.busy != null && !model.lookingAround) { model.cancel() }

    Box(Modifier.fillMaxSize().background(Palette.mintSoft)) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
            when (route) {
                null -> {
                    TopBar(title = null, onBack = null, actions = {
                        IconButton(onClick = { model.push(Route.Reminders) }) {
                            Icon(Icons.Filled.Notifications, contentDescription = "Your reminders", tint = Palette.ink)
                        }
                        IconButton(onClick = { showAbout = true }) {
                            Icon(Icons.Filled.Info, contentDescription = "About ATLAS and privacy", tint = Palette.ink)
                        }
                    })
                    HomeScreen(model, onAbout = { showAbout = true })
                }
                Route.Check -> { TopBar("Step 1 of 3", onBack = { model.back() }); CheckTextScreen(model) }
                Route.Steps -> { TopBar("Step 1 of 3", onBack = { model.back() }); CareStepsScreen(model) }
                Route.Barriers -> { TopBar("Step 2 of 3", onBack = { model.back() }); BarriersScreen(model) }
                Route.Plan -> { TopBar("Step 3 of 3", onBack = { model.back() }); PlanScreen(model) }
                Route.Reminders -> { TopBar("Your reminders", onBack = { model.back() }); RemindersListScreen() }
                Route.Labs -> { TopBar("Lab results", onBack = { model.back() }); LabResultsScreen(model) }
            }
        }

        // Looking around while a read or plan runs: a small note with a way out, then the ready cue when it lands.
        val cue = model.readyCue
        if (cue != null) {
            ReadyCueButton(cue, Modifier.align(Alignment.BottomCenter)) { model.showReady() }
        } else if (model.busy != null && model.lookingAround) {
            StillWorkingPill(model, Modifier.align(Alignment.BottomCenter))
        }

        model.busy?.takeIf { !model.lookingAround }?.let {
            BusyOverlay(it, onCancel = { model.cancel() }, onLookAround = { model.lookingAround = true })
        }
    }
    // The cue's result was opened another way: it is no longer needed (onSeen on the website).
    LaunchedEffect(route) {
        val mark = model.readyMark
        if (mark != null && route == ReadyCue.route(mark.what)) model.clearReady()
    }

    if (showAbout) AboutDialog(model, onDismiss = { showAbout = false })

    model.error?.let { message ->
        AlertDialog(
            onDismissRequest = { model.error = null },
            title = { Text("Something went wrong") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { model.error = null }) { Text("OK") } },
            containerColor = Palette.paper,
        )
    }
}

@Composable
fun TopBar(title: String?, onBack: (() -> Unit)?, actions: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Palette.ink)
            }
        } else {
            Spacer(Modifier.width(48.dp))
        }
        Text(
            title.orEmpty(),
            style = Type.headline,
            textAlign = TextAlign.Center,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        Row { actions() }
        if (onBack != null) Spacer(Modifier.width(48.dp))
    }
}

/** Scrolling screen body with the standard padding. */
@Composable
fun ScreenBody(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(PaddingValues(16.dp)),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        content()
        Spacer(Modifier.height(24.dp))
    }
}

/** Progress for the 10 to 25 second calls, with a way out. */
@Composable
fun BusyOverlay(busy: Busy, onCancel: () -> Unit, onLookAround: () -> Unit = {}) {
    val (title, note) = when (busy) {
        Busy.Recognizing -> "Reading your photo on this phone..." to "The photo stays on your phone."
        Busy.Reading -> "Reading your paper..." to "Finding each step and checking it against your paper. This takes 10 to 25 seconds."
        Busy.Planning -> "Building your plan..." to "Matching your steps with verified clinics and programs near you. This takes 10 to 25 seconds."
    }
    Box(
        Modifier
            .fillMaxSize()
            .background(Palette.ink.copy(alpha = 0.35f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
        contentAlignment = Alignment.Center,
    ) {
        val shape = RoundedCornerShape(26.dp)
        Column(
            Modifier
                .padding(28.dp)
                .background(Palette.paper, shape)
                .border(2.5.dp, Palette.ink, shape)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            CircularProgressIndicator(color = Palette.teal, modifier = Modifier.size(44.dp))
            Text(title, style = Type.title3.copy(fontWeight = FontWeight.ExtraBold), textAlign = TextAlign.Center)
            Text(note, style = Type.sub.copy(color = Palette.inkSoft), textAlign = TextAlign.Center)
            OutlinePill("Cancel", onClick = onCancel, contentDescription = "Cancel. Stops this and keeps what you entered")
            // Reading and planning run on the server: the person may keep using the app, and the ready cue brings them
            // back. Reading a photo happens on this phone and is quick, so it keeps the card.
            if (busy == Busy.Reading || busy == Busy.Planning) {
                TextLink("Look around while you wait", onClick = onLookAround, color = Palette.ink,
                    modifier = Modifier.semantics { contentDescription = "Look around while you wait. We will show a button when it is ready" })
            }
        }
    }
}

/** While the person looks around: what is still running, with Cancel. */
@Composable
fun StillWorkingPill(model: AppModel, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(50)
    Row(
        modifier.navigationBarsPadding().padding(bottom = 12.dp).background(Palette.paper, shape).border(2.dp, Palette.ink, shape)
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CircularProgressIndicator(color = Palette.teal, modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        Text(if (model.busy == Busy.Planning) "Building your plan..." else "Reading your paper...", style = Type.sub.copy(fontWeight = FontWeight.Bold))
        TextLink("Cancel", onClick = { model.cancel() }, color = Palette.ink,
            modifier = Modifier.semantics { contentDescription = "Cancel. Stops this and keeps what you entered" })
    }
}

/**
 * "Your plan is ready: show me" (web/src/ui/ReadyCue.tsx): floats at the bottom of every screen until it is used or the
 * result is opened. Its arrival is said once, politely, through a live region.
 */
@Composable
fun ReadyCueButton(what: ReadyCue.What, modifier: Modifier = Modifier, onGo: () -> Unit) {
    val label = ReadyCue.label(what)
    val shape = RoundedCornerShape(50)
    Box(Modifier.size(1.dp).semantics { liveRegion = LiveRegionMode.Polite; contentDescription = label })
    Box(
        modifier.navigationBarsPadding().padding(bottom = 16.dp).heightIn(min = 52.dp).background(Palette.sun, shape).border(2.5.dp, Palette.ink, shape)
            .clickable(role = Role.Button, onClick = onGo).semantics { contentDescription = "$label: show me" }
            .padding(horizontal = 20.dp, vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            buildAnnotatedString {
                append("\u2713 $label: ")
                withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) { append("show me") }
            },
            style = Type.headline,
        )
    }
}
