import {cn} from "@/lib/utils";

interface DiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  originalLabel?: string;
  modifiedLabel?: string;
}

export function DiffViewer({
  originalContent,
  modifiedContent,
  originalLabel = "Original",
  modifiedLabel = "Migrated",
}: Readonly<DiffViewerProps>) {
  const originalLines = originalContent.split("\n");
  const modifiedLines = modifiedContent.split("\n");

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{originalLabel}</p>
        <div className="rounded-md border bg-muted/50 p-4 overflow-auto max-h-96">
          <pre className="text-xs font-mono">
            {originalLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-8 text-muted-foreground select-none">{i + 1}</span>
                <span>{line}</span>
              </div>
            ))}
          </pre>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{modifiedLabel}</p>
        <div className="rounded-md border bg-muted/50 p-4 overflow-auto max-h-96">
          <pre className="text-xs font-mono">
            {modifiedLines.map((line, i) => {
              const isModified = originalLines[i] !== line;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex",
                    isModified && "bg-green-100 dark:bg-green-900/30"
                  )}
                >
                  <span className="w-8 text-muted-foreground select-none">{i + 1}</span>
                  <span>{line}</span>
                </div>
              );
            })}
          </pre>
        </div>
      </div>
    </div>
  );
}
