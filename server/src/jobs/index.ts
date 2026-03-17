import {statePoller} from "./state-poller.js"
import {fileWatcher} from "./file-watcher.js"
import {updateChecker} from "./update-checker.js"
import {diskChecker} from "./disk-checker.js"
import {notificationWatcher} from "./notification-watcher.js"

export async function startJobs(): Promise<void> {
    await statePoller.start()
    await fileWatcher.start()
    await updateChecker.start()
    await diskChecker.start()
    notificationWatcher.start()
}

export function stopJobs(): void {
    statePoller.stop()
    void fileWatcher.stop()
    updateChecker.stop()
    diskChecker.stop()
    notificationWatcher.stop()
}
