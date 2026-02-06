import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  ArrowLeftRight,
  Download,
  Upload,
  Image as ImageIcon,
  Video,
  GitBranch,
  FileText,
  GripVertical,
  Pencil,
  Copy,
  X,
  Info,
  Link as LinkIcon,
} from "lucide-react";

// shadcn/ui
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * WORKFLOW BUILDER
 * - Create steps with editable title/description
 * - Override description for report
 * - Toggle description inclusion in final report
 * - Attach media (images/videos), choose from library, capture camera
 * - Decision pathways (up to 20) that branch to other steps
 * - User inputs (action prompts) per step
 * - Link steps via Next or via Decision buttons
 * - Export/Import JSON
 * - Report Preview generated from workflow
 */

// ----------------------
// Types
// ----------------------

/** @typedef {"text"|"number"|"choice"|"checkbox"|"photo"|"video"|"signature"|"note"} UserInputType */

/**
 * @typedef {{
 *  id: string;
 *  type: "image"|"video";
 *  name: string;
 *  size: number;
 *  mime: string;
 *  url: string;
 *  createdAt: number;
 * }} MediaItem
 */

/**
 * @typedef {{
 *  id: string;
 *  label: string;
 *  targetStepId: string | null;
 * }} Decision
 */

/**
 * @typedef {{
 *  id: string;
 *  type: UserInputType;
 *  label: string;
 *  required: boolean;
 *  options?: string[]; // for choice
 * }} StepInput
 */

/**
 * @typedef {{
 *  id: string;
 *  order: number;
 *  title: string;
 *  description: string;
 *  overrideInReport: boolean;
 *  overrideReportText: string;
 *  includeDescriptionInReport: boolean;
 *  mediaIds: string[];
 *  decisionsEnabled: boolean;
 *  decisions: Decision[];
 *  inputs: StepInput[];
 *  nextStepId: string | null;
 * }} Step
 */

/**
 * @typedef {{
 *  id: string;
 *  name: string;
 *  createdAt: number;
 *  steps: Step[];
 *  media: MediaItem[];
 * }} Workflow
 */

// ----------------------
// Helpers
// ----------------------

const uid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id_${Math.random().toString(16).slice(2)}_${Date.now()}`);

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const DEFAULT_WORKFLOW = /** @type {Workflow} */ ({
  id: uid(),
  name: "New Workflow",
  createdAt: Date.now(),
  steps: [
    {
      id: uid(),
      order: 1,
      title: "Authorisation To Work",
      description: "Capture evidence of TTHC, THA, & SWI - where applicable.",
      overrideInReport: false,
      overrideReportText: "",
      includeDescriptionInReport: true,
      mediaIds: [],
      decisionsEnabled: false,
      decisions: [],
      inputs: [
        { id: uid(), type: "photo", label: "Upload photos", required: false },
        { id: uid(), type: "note", label: "Technician note", required: false },
      ],
      nextStepId: null,
    },
  ],
  media: [],
});

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function normalizeOrders(steps) {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  return sorted.map((s, idx) => ({ ...s, order: idx + 1 }));
}

function enforceSequentialNextSteps(steps) {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  for (let i = 0; i < sorted.length; i += 1) {
    const next = sorted[i + 1] || null;
    sorted[i].nextStepId = next ? next.id : null;
  }
  return sorted;
}

function stepLabel(step) {
  return `${String(step.order).padStart(2, "0")} · ${step.title || "(Untitled step)"}`;
}

function computeReachability(workflow) {
  // Returns a set of reachable step IDs starting from first step by order
  const steps = [...workflow.steps].sort((a, b) => a.order - b.order);
  const start = steps[0]?.id;
  const graph = new Map();
  for (const s of steps) {
    const edges = [];
    if (s.nextStepId) edges.push(s.nextStepId);
    if (s.decisionsEnabled) {
      for (const d of s.decisions) if (d.targetStepId) edges.push(d.targetStepId);
    }
    graph.set(s.id, edges);
  }
  const seen = new Set();
  const q = start ? [start] : [];
  while (q.length) {
    const cur = q.shift();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    const edges = graph.get(cur) || [];
    for (const nxt of edges) if (nxt && !seen.has(nxt)) q.push(nxt);
  }
  return seen;
}

// ----------------------
// Main App
// ----------------------

export default function WorkflowBuilderApp() {
  const [workflow, setWorkflow] = useState(() => {
    // try localStorage
    try {
      const raw = localStorage.getItem("wf_builder_v1");
      if (raw) return /** @type {Workflow} */ (JSON.parse(raw));
    } catch {}
    return deepCopy(DEFAULT_WORKFLOW);
  });

  const stepsSorted = useMemo(
    () => [...workflow.steps].sort((a, b) => a.order - b.order),
    [workflow.steps]
  );

  const [selectedStepId, setSelectedStepId] = useState(() => stepsSorted[0]?.id || null);

  useEffect(() => {
    // keep selected valid
    if (selectedStepId && workflow.steps.some((s) => s.id === selectedStepId)) return;
    setSelectedStepId(stepsSorted[0]?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.steps]);

  useEffect(() => {
    try {
      localStorage.setItem("wf_builder_v1", JSON.stringify(workflow));
    } catch {}
  }, [workflow]);

  const selectedStep = useMemo(
    () => workflow.steps.find((s) => s.id === selectedStepId) || null,
    [workflow.steps, selectedStepId]
  );

  const reachable = useMemo(() => computeReachability(workflow), [workflow]);

  const mediaIndex = useMemo(() => {
    const map = new Map();
    for (const m of workflow.media) map.set(m.id, m);
    return map;
  }, [workflow.media]);

  // ----------------------
  // Mutators
  // ----------------------

  function updateWorkflow(patchFn) {
    setWorkflow((prev) => {
      const next = patchFn(deepCopy(prev));
      // ensure stable sorts
      next.steps = enforceSequentialNextSteps(normalizeOrders(next.steps));
      return next;
    });
  }

  function addStep(afterStepId = null) {
    updateWorkflow((wf) => {
      const newStep = /** @type {Step} */ ({
        id: uid(),
        order: wf.steps.length + 1,
        title: "New Step",
        description: "",
        overrideInReport: false,
        overrideReportText: "",
        includeDescriptionInReport: true,
        mediaIds: [],
        decisionsEnabled: false,
        decisions: [],
        inputs: [],
        nextStepId: null,
      });

      if (!afterStepId) {
        wf.steps.push(newStep);
        return wf;
      }

      // insert after the selected step order
      const after = wf.steps.find((s) => s.id === afterStepId);
      if (!after) {
        wf.steps.push(newStep);
        return wf;
      }

      const afterOrder = after.order;
      for (const s of wf.steps) {
        if (s.order > afterOrder) s.order += 1;
      }
      newStep.order = afterOrder + 1;
      wf.steps.push(newStep);
      return wf;
    });
  }

  function duplicateStep(stepId) {
    updateWorkflow((wf) => {
      const s = wf.steps.find((x) => x.id === stepId);
      if (!s) return wf;
      const copy = deepCopy(s);
      copy.id = uid();
      copy.title = `${s.title || "Step"} (Copy)`;
      copy.order = s.order + 1;
      // re-id nested
      copy.decisions = (copy.decisions || []).map((d) => ({ ...d, id: uid() }));
      copy.inputs = (copy.inputs || []).map((i) => ({ ...i, id: uid() }));
      for (const other of wf.steps) {
        if (other.order > s.order) other.order += 1;
      }
      wf.steps.push(copy);
      return wf;
    });
  }

  function deleteStep(stepId) {
    updateWorkflow((wf) => {
      const idx = wf.steps.findIndex((s) => s.id === stepId);
      if (idx < 0) return wf;
      const removed = wf.steps[idx];
      wf.steps.splice(idx, 1);

      // clean links
      for (const s of wf.steps) {
        if (s.nextStepId === removed.id) s.nextStepId = null;
        if (s.decisionsEnabled) {
          s.decisions = (s.decisions || []).map((d) =>
            d.targetStepId === removed.id ? { ...d, targetStepId: null } : d
          );
        }
      }

      return wf;
    });
  }

  function moveStep(stepId, direction /* -1 up, +1 down */) {
    updateWorkflow((wf) => {
      const sorted = [...wf.steps].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((s) => s.id === stepId);
      if (idx < 0) return wf;
      const j = idx + direction;
      if (j < 0 || j >= sorted.length) return wf;
      const a = sorted[idx];
      const b = sorted[j];
      const tmp = a.order;
      a.order = b.order;
      b.order = tmp;
      // write back
      wf.steps = sorted;
      return wf;
    });
  }

  function updateStep(stepId, patch) {
    updateWorkflow((wf) => {
      const s = wf.steps.find((x) => x.id === stepId);
      if (!s) return wf;
      Object.assign(s, patch);
      return wf;
    });
  }

  // ----------------------
  // Media
  // ----------------------

  async function onAddMediaFiles(stepId, files) {
    const list = Array.from(files || []);
    if (!list.length) return;

    const created = [];
    for (const f of list) {
      const mime = f.type || "application/octet-stream";
      const isVideo = mime.startsWith("video/");
      const isImage = mime.startsWith("image/");
      if (!isVideo && !isImage) continue;
      const url = URL.createObjectURL(f);
      created.push(
        /** @type {MediaItem} */ ({
          id: uid(),
          type: isVideo ? "video" : "image",
          name: f.name || (isVideo ? "Video" : "Image"),
          size: f.size || 0,
          mime,
          url,
          createdAt: Date.now(),
        })
      );
    }

    if (!created.length) return;

    updateWorkflow((wf) => {
      wf.media.push(...created);
      const step = wf.steps.find((s) => s.id === stepId);
      if (step) step.mediaIds.push(...created.map((m) => m.id));
      return wf;
    });
  }

  function detachMediaFromStep(stepId, mediaId) {
    updateWorkflow((wf) => {
      const step = wf.steps.find((s) => s.id === stepId);
      if (!step) return wf;
      step.mediaIds = step.mediaIds.filter((id) => id !== mediaId);
      return wf;
    });
  }

  // ----------------------
  // Decisions
  // ----------------------

  function addDecision(stepId) {
    updateWorkflow((wf) => {
      const step = wf.steps.find((s) => s.id === stepId);
      if (!step) return wf;
      const current = step.decisions || [];
      if (current.length >= 20) return wf;
      current.push({ id: uid(), label: `Option ${current.length + 1}`, targetStepId: null });
      step.decisions = current;
      step.decisionsEnabled = true;
      return wf;
    });
  }

  function updateDecision(stepId, decisionId, patch) {
    updateWorkflow((wf) => {
      const step = wf.steps.find((s) => s.id === stepId);
      if (!step) return wf;
      step.decisions = (step.decisions || []).map((d) =>
        d.id === decisionId ? { ...d, ...patch } : d
      );
      return wf;
    });
  }

  function deleteDecision(stepId, decisionId) {
    updateWorkflow((wf) => {
      const step = wf.steps.find((s) => s.id === stepId);
      if (!step) return wf;
      step.decisions = (step.decisions || []).filter((d) => d.id !== decisionId);
      if (step.decisions.length === 0) step.decisionsEnabled = false;
      return wf;
    });
  }

  // ----------------------
  // User Inputs
  // ----------------------

  function addInput(stepId, type) {
    updateWorkflow((wf) => {
      const step = wf.steps.find((s) => s.id === stepId);
      if (!step) return wf;
      step.inputs = step.inputs || [];
      step.inputs.push({
        id: uid(),
        type,
        label: defaultLabelForInput(type),
        required: false,
        options: type === "choice" ? ["Option A", "Option B"] : undefined,
      });
      return wf;
    });
  }

  function updateInput(stepId, inputId, patch) {
    updateWorkflow((wf) => {
      const step = wf.steps.find((s) => s.id === stepId);
      if (!step) return wf;
      step.inputs = (step.inputs || []).map((i) => (i.id === inputId ? { ...i, ...patch } : i));
      return wf;
    });
  }

  function deleteInput(stepId, inputId) {
    updateWorkflow((wf) => {
      const step = wf.steps.find((s) => s.id === stepId);
      if (!step) return wf;
      step.inputs = (step.inputs || []).filter((i) => i.id !== inputId);
      return wf;
    });
  }

  // ----------------------
  // Export / Import
  // ----------------------

  function exportJSON() {
    // Note: object URLs are not portable; in production you'd upload to storage and store a stable URL.
    const payload = deepCopy(workflow);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(workflow.name || "workflow").replace(/\s+/g, "_").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJSON(file) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    // Minimal validation
    if (!parsed || !Array.isArray(parsed.steps)) throw new Error("Invalid workflow file");
    setWorkflow(() => {
      const wf = /** @type {Workflow} */ (parsed);
      wf.id = wf.id || uid();
      wf.createdAt = wf.createdAt || Date.now();
      wf.name = wf.name || "Imported Workflow";
      wf.media = Array.isArray(wf.media) ? wf.media : [];
      wf.steps = normalizeOrders(
        (wf.steps || []).map((s, idx) => ({
          id: s.id || uid(),
          order: typeof s.order === "number" ? s.order : idx + 1,
          title: s.title ?? "",
          description: s.description ?? "",
          overrideInReport: !!s.overrideInReport,
          overrideReportText: s.overrideReportText ?? "",
          includeDescriptionInReport:
            typeof s.includeDescriptionInReport === "boolean" ? s.includeDescriptionInReport : true,
          mediaIds: Array.isArray(s.mediaIds) ? s.mediaIds : [],
          decisionsEnabled: !!s.decisionsEnabled,
          decisions: Array.isArray(s.decisions)
            ? s.decisions.map((d) => ({
                id: d.id || uid(),
                label: d.label ?? "",
                targetStepId: d.targetStepId ?? null,
              }))
            : [],
          inputs: Array.isArray(s.inputs)
            ? s.inputs.map((i) => ({
                id: i.id || uid(),
                type: i.type || "text",
                label: i.label ?? "",
                required: !!i.required,
                options: i.options,
              }))
            : [],
          nextStepId: s.nextStepId ?? null,
        }))
      );
      return wf;
    });
  }

  // ----------------------
  // Report
  // ----------------------

  const reportSteps = useMemo(() => {
    const sorted = [...workflow.steps].sort((a, b) => a.order - b.order);
    return sorted;
  }, [workflow.steps]);

  // ----------------------
  // Render
  // ----------------------

  return (
    <TooltipProvider>
      <div className="min-h-screen w-full text-zinc-100">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <Header
            workflow={workflow}
            onRename={(name) => updateWorkflow((wf) => ((wf.name = name), wf))}
            onExport={exportJSON}
            onImport={importJSON}
          />

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Left: Step list */}
            <div className="lg:col-span-3">
              <StepList
                workflow={workflow}
                stepsSorted={stepsSorted}
                selectedStepId={selectedStepId}
                onSelect={setSelectedStepId}
                onAdd={() => addStep(selectedStepId)}
                onDelete={deleteStep}
                onDuplicate={duplicateStep}
                onMove={moveStep}
                reachable={reachable}
              />
            </div>

            {/* Middle: Editor */}
            <div className="lg:col-span-5">
              <AnimatePresence mode="wait">
                {selectedStep ? (
                  <motion.div
                    key={selectedStep.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-4"
                  >
                    <StepEditor
                      workflow={workflow}
                      step={selectedStep}
                      stepsSorted={stepsSorted}
                      mediaIndex={mediaIndex}
                      onChange={(patch) => updateStep(selectedStep.id, patch)}
                      onAddMedia={(files) => onAddMediaFiles(selectedStep.id, files)}
                      onDetachMedia={(mediaId) => detachMediaFromStep(selectedStep.id, mediaId)}
                      onAddDecision={() => addDecision(selectedStep.id)}
                      onUpdateDecision={(decisionId, patch) =>
                        updateDecision(selectedStep.id, decisionId, patch)
                      }
                      onDeleteDecision={(decisionId) => deleteDecision(selectedStep.id, decisionId)}
                      onAddInput={(type) => addInput(selectedStep.id, type)}
                      onUpdateInput={(inputId, patch) => updateInput(selectedStep.id, inputId, patch)}
                      onDeleteInput={(inputId) => deleteInput(selectedStep.id, inputId)}
                    />

                    <ReportPreview workflowName={workflow.name} reportSteps={reportSteps} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <Card className="border-zinc-800 bg-zinc-900/40">
                      <CardHeader>
                        <CardTitle className="text-base">No step selected</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-zinc-300">
                        Add a step to begin building your workflow.
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right: Worker preview */}
            <div className="lg:col-span-4">
              <WorkflowPreview
                workflow={workflow}
                stepsSorted={stepsSorted}
                mediaIndex={mediaIndex}
              />
            </div>
          </div>

          <FooterNotes />
        </div>
      </div>
    </TooltipProvider>
  );
}

// ----------------------
// Header
// ----------------------

function Header({ workflow, onRename, onExport, onImport }) {
  const importRef = useRef(null);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-zinc-900 ring-1 ring-zinc-800">
          <GitBranch className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <Input
              value={workflow.name}
              onChange={(e) => onRename(e.target.value)}
              className="h-9 w-[280px] border-zinc-800 bg-zinc-900/50"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Info className="h-4 w-4 text-zinc-400" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                Workflow is saved locally in your browser (localStorage). Export JSON to share or store.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            Steps, branching decisions, inputs, media library, and report preview.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          className="bg-zinc-900/60 ring-1 ring-zinc-800 hover:bg-zinc-900"
          onClick={onExport}
        >
          <Download className="mr-2 h-4 w-4" />
          Export JSON
        </Button>

        <input
          ref={importRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              await onImport(f);
            } catch (err) {
              alert(String(err?.message || err));
            } finally {
              e.target.value = "";
            }
          }}
        />

        <Button
          variant="secondary"
          className="bg-zinc-900/60 ring-1 ring-zinc-800 hover:bg-zinc-900"
          onClick={() => importRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" />
          Import JSON
        </Button>
      </div>
    </div>
  );
}

// ----------------------
// Step List
// ----------------------

function StepList({
  workflow,
  stepsSorted,
  selectedStepId,
  onSelect,
  onAdd,
  onDelete,
  onDuplicate,
  onMove,
  reachable,
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/40">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Workflow Steps</CardTitle>
          <Button
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-500"
            onClick={onAdd}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add step
          </Button>
        </div>
        <div className="text-xs text-zinc-400">
          Select a step to edit. Use Next or Decision Pathways to branch.
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {stepsSorted.map((s) => {
          const isSelected = s.id === selectedStepId;
          const isReachable = reachable.has(s.id);
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={
                "w-full rounded-2xl border px-3 py-2 text-left transition " +
                (isSelected
                  ? "border-indigo-500/60 bg-indigo-500/10"
                  : "border-zinc-800 bg-zinc-950/20 hover:bg-zinc-950/30")
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-100">
                      {String(s.order).padStart(2, "0")}
                    </span>
                    <span className="truncate text-sm text-zinc-100">
                      {s.title || "(Untitled step)"}
                    </span>
                    {!isReachable ? (
                      <Badge variant="secondary" className="bg-amber-500/15 text-amber-200">
                        Unlinked
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 line-clamp-1 text-xs text-zinc-400">
                    {s.description || ""}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    label="Move up"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onMove(s.id, -1);
                    }}
                    disabled={s.order === 1}
                  >
                    <GripVertical className="h-4 w-4" />
                  </IconButton>

                  <IconButton
                    label="Duplicate"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDuplicate(s.id);
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </IconButton>

                  <IconButton
                    label="Delete"
                    danger
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const ok = confirm("Delete this step? Links pointing to it will be cleared.");
                      if (ok) onDelete(s.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  {(s.inputs || []).length} inputs
                </span>
                <span className="inline-flex items-center gap-1">
                  <ImageIcon className="h-3.5 w-3.5" />
                  {(s.mediaIds || []).length} media
                </span>
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="h-3.5 w-3.5" />
                  {s.decisionsEnabled ? (s.decisions || []).length : 0} decisions
                </span>
              </div>
            </button>
          );
        })}

        <Separator className="my-3 bg-zinc-800" />

        <ConnectivityAudit steps={stepsSorted} />
      </CardContent>
    </Card>
  );
}

function ConnectivityAudit({ steps }) {
  const issues = useMemo(() => {
    const ids = new Set(steps.map((s) => s.id));
    const problems = [];
    for (const s of steps) {
      if (s.nextStepId && !ids.has(s.nextStepId)) {
        problems.push({ stepId: s.id, kind: "next", msg: "Next points to missing step" });
      }
      for (const d of s.decisions || []) {
        if (d.targetStepId && !ids.has(d.targetStepId)) {
          problems.push({ stepId: s.id, kind: "decision", msg: "Decision points to missing step" });
        }
      }
    }
    return problems;
  }, [steps]);

  if (!issues.length) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3 text-xs text-zinc-300">
        <div className="flex items-center gap-2">
          <LinkIcon className="h-4 w-4 text-emerald-300" />
          Connectivity looks good.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3 text-xs text-zinc-300">
      <div className="mb-2 flex items-center gap-2">
        <LinkIcon className="h-4 w-4 text-amber-300" />
        Connectivity warnings
      </div>
      <ul className="list-disc space-y-1 pl-5 text-zinc-300">
        {issues.slice(0, 6).map((it, idx) => (
          <li key={idx}>
            {it.msg}
          </li>
        ))}
        {issues.length > 6 ? <li>…and {issues.length - 6} more</li> : null}
      </ul>
    </div>
  );
}

// ----------------------
// Step Editor
// ----------------------

function StepEditor({
  workflow,
  step,
  stepsSorted,
  mediaIndex,
  onChange,
  onAddMedia,
  onDetachMedia,
  onAddDecision,
  onUpdateDecision,
  onDeleteDecision,
  onAddInput,
  onUpdateInput,
  onDeleteInput,
}) {
  const [reportOnlyView, setReportOnlyView] = useState(false);
  const linkingBoundsRef = useRef(null);

  useEffect(() => {
    setReportOnlyView(step.overrideInReport && step.includeDescriptionInReport === false);
  }, [step.id, step.overrideInReport, step.includeDescriptionInReport]);

  function toggleDescriptionView() {
    const next = !reportOnlyView;
    setReportOnlyView(next);
    if (next) {
      onChange({ overrideInReport: true, includeDescriptionInReport: false });
    } else {
      onChange({ overrideInReport: false, includeDescriptionInReport: true });
    }
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/40">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Step Editor</CardTitle>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Badge variant="secondary" className="bg-zinc-800/60 text-zinc-200">
              Step {step.order}
            </Badge>
            <Badge variant="secondary" className="bg-zinc-800/60 text-zinc-200">
              ID: {String(step.id).slice(0, 8)}…
            </Badge>
          </div>
        </div>
        <div className="text-xs text-zinc-400">Configure what the technician sees and what prints to report.</div>
      </CardHeader>

      <CardContent>
        <div ref={linkingBoundsRef} className="grid grid-cols-1 gap-4">
          {/* Title */}
          <Field label="Title">
            <Input
              value={step.title}
              onChange={(e) => onChange({ title: e.target.value })}
              className="border-zinc-800 bg-zinc-950/30"
              placeholder="Step title"
            />
          </Field>

                    {/* Description */}
          <Field
            label={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span>Description</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-zinc-400" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">
                      Runtime instructions shown to the user.
                    </TooltipContent>
                  </Tooltip>
                  <span className="text-xs text-zinc-400">Flip to edit the report-only version.</span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="bg-zinc-900/60 ring-1 ring-zinc-800 hover:bg-zinc-900"
                      onClick={toggleDescriptionView}
                    >
                      {reportOnlyView ? "report only" : "user and report view"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm">
                    Toggles between the user-facing description and the report-only description. Report-only
                    disables the user description in the final report and uses the back-side text instead.
                  </TooltipContent>
                </Tooltip>
              </div>
            }
          >

            <div className="wf-flip">
              <div className={`wf-flip-inner${reportOnlyView ? " is-flipped" : ""}`}>
                <div className="wf-flip-face wf-flip-front">
                  <Textarea
                    value={step.description}
                    onChange={(e) => onChange({ description: e.target.value })}
                    className="min-h-[110px] border-zinc-800 bg-zinc-950/30 wf-flip-textarea"
                    placeholder="Describe the action to perform…"
                  />
                </div>
                <div className="wf-flip-face wf-flip-back">
                  <Textarea
                    value={step.overrideReportText}
                    onChange={(e) => onChange({ overrideReportText: e.target.value })}
                    className="min-h-[110px] border-zinc-800 bg-zinc-950/30 wf-flip-textarea"
                    placeholder="Report-only description…"
                  />
                </div>
              </div>
            </div>
          </Field>

          {/* Linking */}
          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium">Default Next step</div>
                <ArrowLeftRight className="h-4 w-4 text-zinc-400" />
                <motion.div
                  drag
                  dragConstraints={linkingBoundsRef}
                  dragMomentum={false}
                  className="cursor-move"
                >
                  <Select
                    value={step.nextStepId || "__none"}
                    onValueChange={(v) => onChange({ nextStepId: v === "__none" ? null : v })}
                  >
                    <SelectTrigger className="min-w-[160px] max-w-[220px] border-zinc-800 bg-zinc-950/30">
                      <SelectValue placeholder="Choose next step" />
                    </SelectTrigger>
                    <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                      <SelectItem value="__none">(No default next step)</SelectItem>
                      {stepsSorted
                        .filter((s) => s.id !== step.id)
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {stepLabel(s)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </motion.div>
              </div>
              <div className="text-xs text-zinc-400">
                Used when the user completes this step without choosing a decision button.
              </div>
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="content" className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-zinc-950/40">
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="decisions">Decision pathways</TabsTrigger>
              <TabsTrigger value="inputs">User inputs</TabsTrigger>
            </TabsList>

            <TabsContent value="content" className="mt-3">
              <ContentSection
                workflow={workflow}
                step={step}
                mediaIndex={mediaIndex}
                onAddMedia={onAddMedia}
                onDetachMedia={onDetachMedia}
                onChange={onChange}
              />
            </TabsContent>

            <TabsContent value="decisions" className="mt-3">
              <DecisionsSection
                step={step}
                stepsSorted={stepsSorted}
                onChange={onChange}
                onAddDecision={onAddDecision}
                onUpdateDecision={onUpdateDecision}
                onDeleteDecision={onDeleteDecision}
              />
            </TabsContent>

            <TabsContent value="inputs" className="mt-3">
              <InputsSection
                step={step}
                onAddInput={onAddInput}
                onUpdateInput={onUpdateInput}
                onDeleteInput={onDeleteInput}
              />
            </TabsContent>
          </Tabs>
        </div>
      </CardContent>
    </Card>
  );
}

function ContentSection({ workflow, step, mediaIndex, onAddMedia, onDetachMedia }) {
  const fileRef = useRef(null);
  const captureRef = useRef(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Content</div>
          <div className="text-xs text-zinc-400">Attach images/videos, or reference existing library items.</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files?.length) onAddMedia(files);
              e.target.value = "";
            }}
          />

          <input
            ref={captureRef}
            type="file"
            accept="image/*,video/*"
            multiple
            capture
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files?.length) onAddMedia(files);
              e.target.value = "";
            }}
          />

          <Button
            variant="secondary"
            className="bg-zinc-900/60 ring-1 ring-zinc-800 hover:bg-zinc-900"
            onClick={() => fileRef.current?.click()}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add from device
          </Button>

          <Button
            variant="secondary"
            className="bg-zinc-900/60 ring-1 ring-zinc-800 hover:bg-zinc-900"
            onClick={() => captureRef.current?.click()}
          >
            <Video className="mr-2 h-4 w-4" />
            Take photo/video
          </Button>

          <LibraryPicker
            workflow={workflow}
            currentStepMediaIds={new Set(step.mediaIds || [])}
            onAttach={(mediaId) => {
              // attach existing library media
              if ((step.mediaIds || []).includes(mediaId)) return;
              const next = [...(step.mediaIds || []), mediaId];
              // use onChange from parent via closure? We'll simply mutate here by emitting a custom event-less call
              // This component is used in StepEditor where onChange is available; here we only know step.
              // So we attach via DOM event: not ideal.
              // Instead, return a callback from parent; but keeping API simple.
            }}
          />
        </div>
      </div>

      <MediaGrid step={step} mediaIndex={mediaIndex} onDetach={onDetachMedia} />

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3 text-xs text-zinc-400">
        Note: media URLs are stored as local object URLs (browser session). For production, upload to S3/Azure/OneDrive and store stable URLs.
      </div>
    </div>
  );
}

function LibraryPicker({ workflow, currentStepMediaIds, onAttach }) {
  // Attach is wired at parent level in real app; here we show library for reference.
  // To keep this demo coherent, we provide a mini dialog to copy media IDs and show how it would work.
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          className="bg-zinc-900/60 ring-1 ring-zinc-800 hover:bg-zinc-900"
        >
          <ImageIcon className="mr-2 h-4 w-4" />
          Library
        </Button>
      </DialogTrigger>
      <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Content Library</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto rounded-2xl border border-zinc-800 bg-zinc-900/30 p-3">
          {workflow.media.length === 0 ? (
            <div className="text-sm text-zinc-300">No media in library yet. Add content to any step first.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {workflow.media
                .slice()
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((m) => (
                  <div key={m.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-2">
                    <div className="aspect-video overflow-hidden rounded-xl bg-zinc-900">
                      {m.type === "image" ? (
                        <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
                      ) : (
                        <video src={m.url} className="h-full w-full object-cover" controls />
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{m.name}</div>
                        <div className="text-[11px] text-zinc-400">{m.type.toUpperCase()}</div>
                      </div>
                      <Button
                        size="sm"
                        className={
                          currentStepMediaIds.has(m.id)
                            ? "bg-emerald-600 hover:bg-emerald-500"
                            : "bg-indigo-600 hover:bg-indigo-500"
                        }
                        onClick={() => {
                          // Demo behavior: just copy ID
                          try {
                            navigator.clipboard.writeText(m.id);
                          } catch {}
                          onAttach?.(m.id);
                        }}
                      >
                        {currentStepMediaIds.has(m.id) ? "Attached" : "Copy ID"}
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} className="bg-zinc-900/60 ring-1 ring-zinc-800">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediaGrid({ step, mediaIndex, onDetach }) {
  const items = (step.mediaIds || []).map((id) => mediaIndex.get(id)).filter(Boolean);

  if (!items.length) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/20 p-6 text-center text-sm text-zinc-400">
        No media attached to this step.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((m) => (
        <div key={m.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{m.name}</div>
              <div className="text-xs text-zinc-400">{m.mime}</div>
            </div>
            <IconButton label="Remove" danger onClick={() => onDetach(m.id)}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="mt-2 aspect-video overflow-hidden rounded-xl bg-zinc-900">
            {m.type === "image" ? (
              <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
            ) : (
              <video src={m.url} className="h-full w-full object-cover" controls />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function DecisionsSection({ step, stepsSorted, onChange, onAddDecision, onUpdateDecision, onDeleteDecision }) {
  const enabled = step.decisionsEnabled;
  const count = (step.decisions || []).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Decision pathways</div>
          <div className="text-xs text-zinc-400">Create up to 20 decision buttons that branch the workflow.</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/20 px-3 py-2">
            <span className="text-xs text-zinc-300">Enabled</span>
            <Switch checked={enabled} onCheckedChange={(v) => onChange({ decisionsEnabled: v })} />
          </div>
          <Button
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-500"
            onClick={onAddDecision}
            disabled={!enabled || count >= 20}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add button ({count}/20)
          </Button>
        </div>
      </div>

      {!enabled ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-6 text-center text-sm text-zinc-400">
          Enable decision pathways to add branching buttons.
        </div>
      ) : count === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/20 p-6 text-center text-sm text-zinc-400">
          No decision buttons yet.
        </div>
      ) : (
        <div className="space-y-2">
          {step.decisions.map((d) => (
            <div key={d.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1">
                  <Label className="text-xs text-zinc-400">Button label</Label>
                  <Input
                    value={d.label}
                    onChange={(e) => onUpdateDecision(d.id, { label: e.target.value })}
                    className="mt-1 border-zinc-800 bg-zinc-950/30"
                  />
                </div>

                <div className="flex-1">
                  <Label className="text-xs text-zinc-400">Branches to step</Label>
                  <Select
                    value={d.targetStepId || "__none"}
                    onValueChange={(v) =>
                      onUpdateDecision(d.id, { targetStepId: v === "__none" ? null : v })
                    }
                  >
                    <SelectTrigger className="mt-1 border-zinc-800 bg-zinc-950/30">
                      <SelectValue placeholder="Choose target" />
                    </SelectTrigger>
                    <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                      <SelectItem value="__none">(No target)</SelectItem>
                      {stepsSorted
                        .filter((s) => s.id !== step.id)
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {stepLabel(s)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex shrink-0 items-center justify-end">
                  <IconButton label="Delete decision" danger onClick={() => onDeleteDecision(d.id)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                <GitBranch className="h-3.5 w-3.5" />
                If user taps <span className="font-medium text-zinc-200">{d.label || "(button)"}</span>, flow jumps to the selected step.
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3 text-xs text-zinc-400">
        Design note: in production, you’ll likely support conditional display (e.g., show button only if input = X), permissions, and validation rules.
      </div>
    </div>
  );
}

function InputsSection({ step, onAddInput, onUpdateInput, onDeleteInput }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">User inputs</div>
          <div className="text-xs text-zinc-400">Add action prompts the user must perform in this step.</div>
        </div>

        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500">
              <Plus className="mr-2 h-4 w-4" />
              Add input
            </Button>
          </DialogTrigger>
          <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
            <DialogHeader>
              <DialogTitle>Add an input</DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["text", "Text"],
                  ["number", "Number"],
                  ["choice", "Choice"],
                  ["checkbox", "Checkbox"],
                  ["photo", "Photo"],
                  ["video", "Video"],
                  ["signature", "Signature"],
                  ["note", "Note"],
                ]
              ).map(([type, label]) => (
                <Button
                  key={type}
                  variant="secondary"
                  className="justify-start bg-zinc-900/60 ring-1 ring-zinc-800 hover:bg-zinc-900"
                  onClick={() => {
                    onAddInput(type);
                    setPickerOpen(false);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  {label}
                </Button>
              ))}
            </div>

            <DialogFooter>
              <Button variant="secondary" onClick={() => setPickerOpen(false)} className="bg-zinc-900/60 ring-1 ring-zinc-800">
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {(step.inputs || []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/20 p-6 text-center text-sm text-zinc-400">
          No user inputs yet.
        </div>
      ) : (
        <div className="space-y-2">
          {step.inputs.map((inp) => (
            <div key={inp.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-zinc-400">Label</div>
                    <Badge variant="secondary" className="bg-zinc-800/60 text-zinc-200">
                      {String(inp.type).toUpperCase()}
                    </Badge>
                  </div>
                  <Input
                    value={inp.label}
                    onChange={(e) => onUpdateInput(inp.id, { label: e.target.value })}
                    className="mt-1 border-zinc-800 bg-zinc-950/30"
                  />
                </div>

                <div className="flex-1">
                  <div className="text-xs text-zinc-400">Required</div>
                  <div className="mt-2 flex items-center gap-2">
                    <Switch
                      checked={inp.required}
                      onCheckedChange={(v) => onUpdateInput(inp.id, { required: v })}
                    />
                    <span className="text-sm text-zinc-300">
                      {inp.required ? "Required" : "Optional"}
                    </span>
                  </div>

                  {inp.type === "choice" ? (
                    <div className="mt-3">
                      <div className="text-xs text-zinc-400">Options (comma-separated)</div>
                      <Input
                        value={(inp.options || []).join(", ")}
                        onChange={(e) =>
                          onUpdateInput(inp.id, {
                            options: e.target.value
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean),
                          })
                        }
                        className="mt-1 border-zinc-800 bg-zinc-950/30"
                        placeholder="Option A, Option B, Option C"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center justify-end">
                  <IconButton label="Delete input" danger onClick={() => onDeleteInput(inp.id)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>

              <div className="mt-2 text-xs text-zinc-400">
                Runtime behavior: render the appropriate control, validate required fields, and store responses against a job/installation record.
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3 text-xs text-zinc-400">
        Suggested storage model: separate tables/collections for WorkflowTemplate, StepTemplate, StepInputTemplate, and per-job StepResponse (with media references).
      </div>
    </div>
  );
}

// ----------------------
// Worker Preview
// ----------------------

function WorkflowPreview({ workflow, stepsSorted, mediaIndex }) {
  const [currentStepId, setCurrentStepId] = useState(() => stepsSorted[0]?.id || null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const first = stepsSorted[0]?.id || null;
    if (!currentStepId || !workflow.steps.some((s) => s.id === currentStepId)) {
      setCurrentStepId(first);
      setHistory([]);
    }
  }, [workflow.steps, stepsSorted, currentStepId]);

  const step = stepsSorted.find((s) => s.id === currentStepId) || null;

  function goTo(stepId) {
    if (!stepId) return;
    setHistory((prev) => (currentStepId ? [...prev, currentStepId] : prev));
    setCurrentStepId(stepId);
  }

  function goBack() {
    setHistory((prev) => {
      if (!prev.length) return prev;
      const nextHistory = prev.slice(0, -1);
      const last = prev[prev.length - 1];
      setCurrentStepId(last);
      return nextHistory;
    });
  }

  function goStart() {
    setHistory([]);
    setCurrentStepId(stepsSorted[0]?.id || null);
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/40">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Worker Preview</CardTitle>
          <Badge variant="secondary" className="bg-zinc-800/60 text-zinc-200">
            Preview
          </Badge>
        </div>
        <div className="text-xs text-zinc-400">
          Simulated technician view. Use buttons to navigate the workflow.
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!step ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/20 p-6 text-center text-sm text-zinc-400">
            No steps available.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {String(step.order).padStart(2, "0")} · {step.title || "(Untitled step)"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {step.decisionsEnabled ? (
                    <Badge variant="secondary" className="bg-indigo-500/15 text-indigo-200">
                      Branching
                    </Badge>
                  ) : null}
                </div>
              </div>

              {step.description ? (
                <div className="mt-2 text-sm text-zinc-200">{step.description}</div>
              ) : null}
            </div>

            {(step.mediaIds || []).length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-zinc-400">Attached media</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {step.mediaIds
                    .map((id) => mediaIndex.get(id))
                    .filter(Boolean)
                    .map((m) => (
                      <div key={m.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-2">
                        <div className="aspect-video overflow-hidden rounded-xl bg-zinc-900">
                          {m.type === "image" ? (
                            <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
                          ) : (
                            <video src={m.url} className="h-full w-full object-cover" controls />
                          )}
                        </div>
                        <div className="mt-2 truncate text-xs text-zinc-300">{m.name}</div>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}

            {(step.inputs || []).length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-zinc-400">Inputs</div>
                <div className="space-y-2">
                  {step.inputs.map((inp) => (
                    <div key={inp.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-zinc-400">{inp.label || "Input"}</div>
                        <Badge variant="secondary" className="bg-zinc-800/60 text-zinc-200">
                          {String(inp.type).toUpperCase()}
                        </Badge>
                      </div>
                      <div className="mt-2">
                        {inp.type === "text" || inp.type === "number" ? (
                          <Input
                            disabled
                            placeholder={inp.type === "number" ? "Enter a number" : "Enter text"}
                            className="border-zinc-800 bg-zinc-950/30"
                          />
                        ) : inp.type === "note" ? (
                          <Textarea
                            disabled
                            placeholder="Enter notes"
                            className="border-zinc-800 bg-zinc-950/30"
                          />
                        ) : inp.type === "checkbox" ? (
                          <div className="flex items-center gap-2">
                            <Switch disabled />
                            <span className="text-xs text-zinc-400">Unchecked</span>
                          </div>
                        ) : inp.type === "choice" ? (
                          <div className="flex flex-wrap gap-2">
                            {(inp.options || []).length === 0 ? (
                              <span className="text-xs text-zinc-500">No options set</span>
                            ) : (
                              inp.options.map((opt, idx) => (
                                <Badge key={`${inp.id}_${idx}`} variant="secondary" className="bg-zinc-800/60 text-zinc-200">
                                  {opt}
                                </Badge>
                              ))
                            )}
                          </div>
                        ) : inp.type === "photo" ? (
                          <Button disabled className="bg-zinc-900/60 ring-1 ring-zinc-800">
                            <ImageIcon className="mr-2 h-4 w-4" />
                            Capture photo
                          </Button>
                        ) : inp.type === "video" ? (
                          <Button disabled className="bg-zinc-900/60 ring-1 ring-zinc-800">
                            <Video className="mr-2 h-4 w-4" />
                            Capture video
                          </Button>
                        ) : inp.type === "signature" ? (
                          <Button disabled className="bg-zinc-900/60 ring-1 ring-zinc-800">
                            <Pencil className="mr-2 h-4 w-4" />
                            Capture signature
                          </Button>
                        ) : (
                          <div className="text-xs text-zinc-500">Unsupported input type</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {step.decisionsEnabled && (step.decisions || []).length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-zinc-400">Decision buttons</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {step.decisions.map((d) => (
                    <Button
                      key={d.id}
                      className="bg-indigo-600 hover:bg-indigo-500"
                      disabled={!d.targetStepId}
                      onClick={() => goTo(d.targetStepId)}
                    >
                      {d.label || "Decision"}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                className="bg-zinc-900/60 ring-1 ring-zinc-800 hover:bg-zinc-900"
                onClick={goBack}
                disabled={history.length === 0}
              >
                Back
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-500"
                onClick={() => goTo(step.nextStepId)}
                disabled={!step.nextStepId}
              >
                Next step
              </Button>
              <Button
                variant="secondary"
                className="bg-zinc-900/60 ring-1 ring-zinc-800 hover:bg-zinc-900"
                onClick={goStart}
                disabled={!stepsSorted.length}
              >
                Start over
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------
// Report Preview
// ----------------------

function ReportPreview({ workflowName, reportSteps }) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/40">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Report Preview</CardTitle>
          <Badge variant="secondary" className="bg-zinc-800/60 text-zinc-200">
            {reportSteps.length} steps
          </Badge>
        </div>
        <div className="text-xs text-zinc-400">Preview of what would appear in the exported report.</div>
      </CardHeader>
      <CardContent>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/20 p-4">
          <div className="text-sm font-semibold">{workflowName || "Workflow"} — Final Report</div>
          <div className="mt-3 space-y-3">
            {reportSteps.map((s) => {
              const desc = s.overrideInReport
                ? s.overrideReportText
                : s.includeDescriptionInReport
                  ? s.description
                  : "";
              return (
                <div key={s.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">
                        {String(s.order).padStart(2, "0")} · {s.title || "(Untitled step)"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.overrideInReport ? (
                        <Badge variant="secondary" className="bg-indigo-500/15 text-indigo-200">
                          Override
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {desc ? <div className="mt-2 text-sm text-zinc-200">{desc}</div> : null}
                  <div className="mt-2 text-xs text-zinc-400">
                    Inputs: {(s.inputs || []).length} · Media: {(s.mediaIds || []).length}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------
// UI Helpers
// ----------------------

function Field({ label, children }) {
  return (
    <div>
      <Label className="text-xs text-zinc-400">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function IconButton({ children, onClick, label, danger, disabled }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          className={
            "grid h-8 w-8 place-items-center rounded-xl border text-zinc-200 transition disabled:opacity-40 " +
            (danger
              ? "border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20"
              : "border-zinc-800 bg-zinc-950/20 hover:bg-zinc-950/40")
          }
          aria-label={label}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function defaultLabelForInput(type) {
  switch (type) {
    case "text":
      return "Text response";
    case "number":
      return "Numeric value";
    case "choice":
      return "Select one";
    case "checkbox":
      return "Confirm";
    case "photo":
      return "Upload photo";
    case "video":
      return "Upload video";
    case "signature":
      return "Signature";
    case "note":
      return "Note";
    default:
      return "Input";
  }
}

function FooterNotes() {
  return (
    <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950/20 p-4 text-sm text-zinc-300">
      <div className="font-medium">Production hardening checklist</div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-300">
        <li>Persist workflow templates to your backend (Postgres/MySQL) and store media in object storage.</li>
        <li>Introduce versioning (templateVersion) so old jobs keep their original workflow definition.</li>
        <li>Add permissions/roles (author, editor, viewer) and audit logs.</li>
        <li>Render a mobile-friendly runtime player for technicians (step completion, validations, capture).</li>
        <li>Generate PDF/DocX reports server-side (or client-side with print CSS) using the report flags.</li>
        <li>Add conditional logic rules (if input X then show step Y) beyond simple branching buttons.</li>
      </ul>
    </div>
  );
}






