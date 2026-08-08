import fs from "node:fs/promises";
import path from "node:path";
import type { SDLCDiscoveryDocument, SDLCPlan } from "./engine";

interface PptxPresentation {
  layout: string;
  author: string;
  company: string;
  subject: string;
  title: string;
  lang: string;
  addSlide(): PptxSlide;
  writeFile(options: { fileName: string }): Promise<void>;
}
interface PptxSlide {
  background: { color: string };
  addText(text: string | Array<{ text: string; options?: Record<string, unknown> }>, options: Record<string, unknown>): void;
  addShape(shape: string, options: Record<string, unknown>): void;
  addNotes(notes: string): void;
}
type PptxFactory = new () => PptxPresentation;

export interface SDLCDiscoveryPresentationResult {
  outputPath: string;
  slideCount: number;
  generatedAt: string;
}

const theme = {
  background: "0F172A",
  panel: "13233A",
  primary: "4682B4",
  accent: "F6B84B",
  text: "F8FAFC",
  muted: "CBD5E1",
  danger: "F97373"
};
const width = 13.333;
const height = 7.5;

/** Generates the standalone Discovery briefing deck previously offered by StoryForge. */
export async function generateDiscoveryPresentation(
  workspaceRoot: string,
  plan: SDLCPlan
): Promise<SDLCDiscoveryPresentationResult> {
  if (!plan.discoveryDocument)
    throw new Error("Discovery is not enabled for this intent, so there is no Discovery brief to present.");
  const PptxGenJS = require("pptxgenjs") as PptxFactory;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Keystone";
  pptx.company = "Keystone";
  pptx.subject = `StoryForge Discovery brief for ${plan.intent}`;
  pptx.title = `Discovery - ${plan.intent}`;
  pptx.lang = "en-US";

  const discovery = plan.discoveryDocument;
  titleSlide(pptx.addSlide(), plan, discovery);
  summarySlide(pptx.addSlide(), plan, discovery);
  slicesSlide(pptx.addSlide(), plan, discovery);
  qualitySlide(pptx.addSlide(), plan, discovery);
  evidenceSlide(pptx.addSlide(), plan, discovery);
  nextStepsSlide(pptx.addSlide(), plan, discovery);

  const outputDir = path.join(workspaceRoot, ".keystone", "artifacts", "discovery");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${safeName(plan.intentId)}-discovery.pptx`);
  await pptx.writeFile({ fileName: outputPath });
  return { outputPath, slideCount: 6, generatedAt: new Date().toISOString() };
}

function base(slide: PptxSlide, title: string, number: number): void {
  slide.background = { color: theme.background };
  slide.addText(short(title, 64), { x: 0.55, y: 0.42, w: 11.5, h: 0.45, fontFace: "Aptos Display", fontSize: 30, bold: true, color: theme.text, margin: 0, breakLine: false, fit: "shrink" });
  slide.addShape("line", { x: 0.55, y: 1.08, w: 12.2, h: 0, line: { color: theme.primary, width: 1.3 } });
  slide.addText(`KEYSTONE · STORYFORGE DISCOVERY   ${String(number).padStart(2, "0")}/06`, { x: 0.55, y: 7.12, w: 12.2, h: 0.16, fontFace: "Aptos", fontSize: 8, color: theme.muted, margin: 0, align: "right" });
  slide.addNotes("[Sources]\nKeystone repository-aware Discovery artifact. No external assets or claims were used.");
}

function titleSlide(slide: PptxSlide, plan: SDLCPlan, discovery: SDLCDiscoveryDocument): void {
  slide.background = { color: theme.background };
  slide.addText("STORYFORGE DISCOVERY BRIEF", { x: 0.7, y: 0.65, w: 5.6, h: 0.25, fontFace: "Aptos", fontSize: 14, bold: true, color: theme.accent, charSpace: 1.5, margin: 0 });
  slide.addText(short(plan.intent, 72), { x: 0.7, y: 1.55, w: 11.5, h: 1.2, fontFace: "Aptos Display", fontSize: 44, bold: true, color: theme.text, margin: 0, fit: "shrink" });
  slide.addText(short(discovery.summary, 230), { x: 0.73, y: 3.15, w: 8.9, h: 1.1, fontFace: "Aptos", fontSize: 20, color: theme.muted, margin: 0.02, fit: "shrink" });
  slide.addShape("line", { x: 0.72, y: 5.58, w: 11.9, h: 0, line: { color: theme.primary, width: 2 } });
  slide.addText("Repository-aware discovery · ready for product, engineering, and QA alignment", { x: 0.73, y: 5.83, w: 9.7, h: 0.26, fontFace: "Aptos", fontSize: 14, color: theme.text, margin: 0 });
  slide.addNotes("[Sources]\nKeystone repository-aware Discovery artifact. No external assets or claims were used.");
}

function summarySlide(slide: PptxSlide, plan: SDLCPlan, discovery: SDLCDiscoveryDocument): void {
  base(slide, "The discovery frames a focused delivery conversation", 2);
  bulletBlock(slide, "Who this serves", discovery.personas, 0.65, 1.45, 5.7, 2.0, theme.primary);
  bulletBlock(slide, "Assumptions to validate", discovery.assumptions, 6.95, 1.45, 5.7, 2.0, theme.accent);
  bulletBlock(slide, "Questions to resolve", discovery.questions, 0.65, 4.15, 12.0, 1.9, theme.danger);
  slide.addText(`Intent: ${short(plan.intent, 110)}`, { x: 0.65, y: 6.35, w: 12, h: 0.3, fontFace: "Aptos", fontSize: 14, color: theme.muted, margin: 0 });
}

function slicesSlide(slide: PptxSlide, plan: SDLCPlan, discovery: SDLCDiscoveryDocument): void {
  base(slide, "Candidate slices keep delivery small and verifiable", 3);
  const slices = discovery.proposedSlices.slice(0, 4);
  slices.forEach((slice, index) => {
    const y = 1.35 + index * 1.25;
    slide.addText(`${slice.storyPoints} pt`, { x: 0.72, y, w: 0.75, h: 0.3, fontFace: "Aptos", fontSize: 16, bold: true, color: theme.accent, margin: 0 });
    slide.addText(short(slice.title, 76), { x: 1.65, y: y - 0.02, w: 10.65, h: 0.3, fontFace: "Aptos", fontSize: 21, bold: true, color: theme.text, margin: 0, fit: "shrink" });
    slide.addText(short(slice.value, 160), { x: 1.65, y: y + 0.37, w: 10.65, h: 0.5, fontFace: "Aptos", fontSize: 14, color: theme.muted, margin: 0, fit: "shrink" });
    slide.addShape("line", { x: 1.65, y: y + 1.0, w: 10.65, h: 0, line: { color: theme.panel, width: 1 } });
  });
  if (!slices.length) slide.addText("No candidate slice was identified from the available repository evidence.", { x: 0.7, y: 2.5, w: 11.5, h: 0.4, fontSize: 20, color: theme.muted, margin: 0 });
  slide.addText(`${plan.backlogStories.filter((story) => story.kind === "user-story").length} user stories and ${plan.backlogStories.filter((story) => story.kind === "quality-story").length} quality stories generated for the backlog.`, { x: 0.7, y: 6.35, w: 12, h: 0.3, fontFace: "Aptos", fontSize: 14, color: theme.text, margin: 0 });
}

function qualitySlide(slide: PptxSlide, _plan: SDLCPlan, discovery: SDLCDiscoveryDocument): void {
  base(slide, "Quality focus protects the intended outcome", 4);
  bulletBlock(slide, "Quality focus", discovery.qualityFocus, 0.65, 1.45, 5.7, 4.7, theme.primary);
  bulletBlock(slide, "Risks to make explicit", discovery.risks, 6.95, 1.45, 5.7, 4.7, theme.danger);
}

function evidenceSlide(slide: PptxSlide, _plan: SDLCPlan, discovery: SDLCDiscoveryDocument): void {
  base(slide, "Repository evidence grounds the proposed scope", 5);
  const evidence = [...new Set(discovery.proposedSlices.flatMap((slice) => slice.evidence))].slice(0, 8);
  bulletBlock(slide, "Evidence selected by Discovery", evidence, 0.65, 1.45, 12, 4.8, theme.primary);
}

function nextStepsSlide(slide: PptxSlide, plan: SDLCPlan, _discovery: SDLCDiscoveryDocument): void {
  base(slide, "Align, approve, then move through the selected workflow", 6);
  const stages = plan.workflow.enabledStages.map((stage) => stage[0]!.toUpperCase() + stage.slice(1));
  slide.addText("Recommended next action", { x: 0.7, y: 1.55, w: 5.5, h: 0.35, fontFace: "Aptos", fontSize: 24, bold: true, color: theme.accent, margin: 0 });
  slide.addText("Review the Discovery slices, assumptions, questions, and quality focus with the delivery team. Then confirm the generated user and quality stories before executing the remaining stages.", { x: 0.7, y: 2.1, w: 11.6, h: 1.05, fontFace: "Aptos", fontSize: 21, color: theme.text, margin: 0, fit: "shrink" });
  slide.addText("Selected workflow", { x: 0.7, y: 4.15, w: 3.2, h: 0.35, fontFace: "Aptos", fontSize: 24, bold: true, color: theme.accent, margin: 0 });
  slide.addText(stages.join("  →  "), { x: 0.7, y: 4.78, w: 11.7, h: 0.42, fontFace: "Aptos", fontSize: 25, bold: true, color: theme.text, margin: 0, fit: "shrink" });
}

function bulletBlock(slide: PptxSlide, heading: string, values: readonly string[], x: number, y: number, w: number, h: number, accent: string): void {
  slide.addText(heading, { x, y, w, h: 0.32, fontFace: "Aptos", fontSize: 22, bold: true, color: accent, margin: 0 });
  const content = values.length ? values.slice(0, 6).map((value) => ({ text: `${short(value, 150)}\n`, options: { bullet: { indent: 14 }, hanging: 3 } })) : [{ text: "No material item identified.\n", options: { bullet: { indent: 14 }, hanging: 3 } }];
  slide.addText(content, { x, y: y + 0.52, w, h, fontFace: "Aptos", fontSize: 16, color: theme.muted, margin: 0.04, breakLine: false, fit: "shrink" });
}

function short(value: string, maximum: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maximum ? compact : `${compact.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}
function safeName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "discovery";
}
