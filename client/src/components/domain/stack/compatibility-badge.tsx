import {Badge} from "@/components/ui/badge";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {cn} from "@/lib/utils";

interface CompatibilityBadgeProps {
  compatibility: "green" | "yellow" | "red";
  unsupportedFeatures?: string[];
}

const BADGE_CONFIG = {
  green: {
    label: "Ready",
    className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100",
    tooltip: "This stack uses only relative bind mounts and is ready to adopt in-place.",
  },
  yellow: {
    label: "Migration Recommended",
    className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100",
    tooltip: "This stack has named volumes, absolute bind mounts, or inline environment variables. Full migration recommended for backup compatibility.",
  },
  red: {
    label: "Unsupported",
    className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 hover:bg-red-100",
    tooltip: "This stack uses Docker Compose features not supported by Docktor (configs, secrets, complex depends_on, or external networks beyond simple external:true).",
  },
};

export function CompatibilityBadge({compatibility, unsupportedFeatures}: Readonly<CompatibilityBadgeProps>) {
  const config = BADGE_CONFIG[compatibility];
  const tooltipText = unsupportedFeatures?.length
    ? `${config.tooltip} Issues: ${unsupportedFeatures.join(", ")}`
    : config.tooltip;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="secondary" className={cn("cursor-help", config.className)}>
            {config.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
