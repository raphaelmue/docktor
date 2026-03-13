import {statePoller} from "./state-poller.js"
import {fileWatcher} from "./file-watcher.js"
import {updateChecker} from "./update-checker.js"

export async function startJobs(): Promise<void> {
    await statePoller.start()
    await fileWatcher.start()
    await updateChecker.start()
}

export function stopJobs(): void {
    statePoller.stop()
    void fileWatcher.stop()
    updateChecker.stop()
}
