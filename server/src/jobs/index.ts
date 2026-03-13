import {statePoller} from "./state-poller.js"
import {fileWatcher} from "./file-watcher.js"
// updateChecker will be imported in 02-04 once implemented

export async function startJobs(): Promise<void> {
    await statePoller.start()
    await fileWatcher.start()
    // await updateChecker.start()  — added in plan 02-04
}

export function stopJobs(): void {
    statePoller.stop()
    void fileWatcher.stop()
    // updateChecker.stop()  — added in plan 02-04
}
