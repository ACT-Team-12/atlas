package com.stephensookra.atlas.data

/** Same labeled sample as web/src/lib/sampleLabs.ts (checked by a unit test). Describes no real patient. */
object LabSample {
    const val LABEL = "Sample lab report (written by Team ATLAS, not a real patient)"
    val TEXT: String = listOf(
        "SAMPLE LAB REPORT (written by Team ATLAS, not a real patient)",
        "Collected: 10/01/2026   Ordering provider: Sample Provider, MD",
        "",
        "COMPREHENSIVE METABOLIC PANEL",
        "Test                     Result    Units      Reference Range   Flag",
        "Glucose, fasting         126       mg/dL      70-99             H",
        "Sodium                   139       mmol/L     136-145",
        "Potassium                3.2       mmol/L     3.5-5.1           L",
        "Creatinine               1.1       mg/dL      0.6-1.2",
        "eGFR                     68        mL/min     >=60",
        "",
        "HEMOGLOBIN A1C",
        "Hemoglobin A1c           7.4       %          <5.7              H",
        "",
        "LIPID PANEL",
        "Total Cholesterol        214       mg/dL      <200              H",
        "LDL Cholesterol          142       mg/dL      <100              H",
        "HDL Cholesterol          44        mg/dL      >40",
        "Triglycerides            148       mg/dL      <150",
        "",
    ).joinToString("\n")
}
