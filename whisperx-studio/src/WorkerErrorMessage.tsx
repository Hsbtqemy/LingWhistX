function workerErrorLineClass(line: string): string {
  const t = line.trimStart();
  if (t.startsWith("[Aide")) {
    return "worker-error-hint";
  }
  if (t.includes("--- stderr")) {
    return "worker-error-sep";
  }
  return "worker-error-line";
}

export function WorkerErrorMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="worker-error-message" role="alert">
      {lines.map((line, i) => (
        <p key={i} className={workerErrorLineClass(line)}>
          {line.length > 0 ? line : "\u00A0"}
        </p>
      ))}
    </div>
  );
}
