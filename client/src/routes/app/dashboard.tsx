import {signOut, useSession} from "@/lib/auth-client";

export default function Dashboard() {
    const {data: session} = useSession();

    return (
        <div className="flex min-h-screen items-center justify-center">
            <div className="text-center space-y-4">
                <h1 className="text-4xl font-bold">Docktor</h1>
                <p className="text-gray-600">Welcome, {session?.user?.name}</p>
                <button
                    onClick={() => signOut()}
                    className="rounded bg-gray-200 px-4 py-2 text-sm hover:bg-gray-300"
                >
                    Sign out
                </button>
            </div>
        </div>
    );
}