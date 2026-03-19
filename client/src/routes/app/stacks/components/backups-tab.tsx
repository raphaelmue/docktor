import {BackupConfigCard} from "./backup-config-card";
import {BackupHistory} from "./backup-history";
import {SnapshotsSection} from "./snapshots-section";

interface BackupsTabProps {
    readonly stackId: string;
    readonly stackName: string;
    readonly stackStatus: string;
}

export function BackupsTab({stackId, stackName, stackStatus}: BackupsTabProps) {
    return (
        <div className="space-y-6">
            <BackupConfigCard stackId={stackId} stackStatus={stackStatus} />
            <BackupHistory stackId={stackId} />
            <SnapshotsSection stackId={stackId} stackName={stackName} stackStatus={stackStatus} />
        </div>
    );
}
