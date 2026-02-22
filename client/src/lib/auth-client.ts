import {createAuthClient} from "better-auth/react";

export const authClient = createAuthClient({
    baseURL: "",
});

export const {useSession, signIn, signUp, signOut} = authClient;
