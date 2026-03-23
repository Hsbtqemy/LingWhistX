#!/usr/bin/env node
/**
 * CLI backlog portable (macOS/Linux/Windows) — même logique que scripts/backlog.ps1
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const backlogPath = join(projectRoot, "backlog", "backlog.json");

function priorityRank(p) {
  if (p === "P0") return 0;
  if (p === "P1") return 1;
  if (p === "P2") return 2;
  return 9;
}

function loadDoc() {
  const raw = readFileSync(backlogPath, "utf8");
  return JSON.parse(raw);
}

function getTaskById(tasks, id) {
  return tasks.find((t) => t.id === id) ?? null;
}

function isTaskReady(task, tasks) {
  if (task.status !== "todo") return false;
  for (const depId of task.dependsOn ?? []) {
    const dep = getTaskById(tasks, depId);
    if (!dep || dep.status !== "done") return false;
  }
  return true;
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    return String(a.id).localeCompare(String(b.id));
  });
}

function printTable(taskList) {
  if (taskList.length === 0) {
    console.log("No tasks.");
    return;
  }
  for (const task of sortTasks(taskList)) {
    const ready = isTaskReady(task, loadDoc().tasks);
    const deps = (task.dependsOn ?? []).join(",");
    console.log(
      `${task.id}\t${task.priority}\t${task.status}\tready=${ready}\tdeps=[${deps}]\t${task.title}`,
    );
  }
}

function showTask(task) {
  console.log(`Id: ${task.id}`);
  console.log(`Title: ${task.title}`);
  console.log(`Status: ${task.status}`);
  console.log(`Priority: ${task.priority}`);
  console.log(`Estimate: ${task.estimate}`);
  console.log(`DependsOn: ${(task.dependsOn ?? []).join(", ")}`);
  console.log("Scope:");
  for (const line of task.scope ?? []) console.log(`  - ${line}`);
  console.log("Execute:");
  for (const line of task.execute ?? []) console.log(`  - ${line}`);
  console.log("DefinitionOfDone:");
  for (const line of task.definitionOfDone ?? []) console.log(`  - ${line}`);
  console.log("Acceptance:");
  for (const line of task.acceptance ?? []) console.log(`  - ${line}`);
}

function parseArgs(argv) {
  const out = { action: "ready", id: "", status: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-Action" || a === "--action") out.action = argv[++i] ?? out.action;
    else if (a === "-Id" || a === "--id") out.id = argv[++i] ?? "";
    else if (a === "-Status" || a === "--status") out.status = argv[++i] ?? "";
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const action = args.action || "ready";

const doc = loadDoc();
const tasks = doc.tasks;

switch (action) {
  case "list": {
    printTable(tasks);
    break;
  }
  case "ready": {
    const ready = tasks.filter((t) => isTaskReady(t, tasks));
    printTable(ready);
    break;
  }
  case "next": {
    const ready = tasks.filter((t) => isTaskReady(t, tasks));
    const sorted = sortTasks(ready);
    if (sorted.length === 0) {
      console.log("No ready task.");
      break;
    }
    showTask(sorted[0]);
    break;
  }
  case "show": {
    if (!args.id) {
      console.error("Use -Id <task-id> with -Action show.");
      process.exit(1);
    }
    const task = getTaskById(tasks, args.id);
    if (!task) {
      console.error(`Task not found: ${args.id}`);
      process.exit(1);
    }
    showTask(task);
    break;
  }
  case "set": {
    if (!args.id || !args.status) {
      console.error("Use -Id <task-id> -Status <todo|in_progress|blocked|done> with -Action set.");
      process.exit(1);
    }
    const task = getTaskById(tasks, args.id);
    if (!task) {
      console.error(`Task not found: ${args.id}`);
      process.exit(1);
    }
    task.status = args.status;
    doc.updatedAt = new Date().toISOString();
    writeFileSync(backlogPath, `${JSON.stringify(doc, null, 4)}\n`, "utf8");
    console.log(`Updated ${args.id} => ${args.status}`);
    break;
  }
  default:
    console.error(`Unknown action: ${action}`);
    process.exit(1);
}
