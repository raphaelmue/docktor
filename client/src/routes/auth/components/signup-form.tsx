import {useState} from "react";
import {Link, useNavigate} from "react-router";
import {useForm} from "react-hook-form";
import {standardSchemaResolver} from "@hookform/resolvers/standard-schema";
import {SignupInput, signupSchema} from "@docktor/shared";
import {signUp} from "@/lib/auth-client";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card, CardContent, CardDescription, CardHeader, CardTitle,} from "@/components/ui/card";
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage,} from "@/components/ui/form";

export function SignupForm() {
    const navigate = useNavigate();
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const form = useForm<SignupInput>({
        resolver: standardSchemaResolver(signupSchema),
        defaultValues: {
            name: "",
            email: "",
            password: "",
        },
    });

    async function onSubmit(values: SignupInput) {
        setError("");
        setLoading(true);

        const {error: signUpError} = await signUp.email({
            name: values.name,
            email: values.email,
            password: values.password,
        });

        if (signUpError) {
            setError(signUpError.message ?? "Sign up failed");
            setLoading(false);
            return;
        }

        navigate("/");
    }

    return (
        <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
                <CardTitle className="text-2xl">Create an account</CardTitle>
                <CardDescription>
                    Enter your details to get started with Docktor
                </CardDescription>
            </CardHeader>
            <CardContent>
                {error && (
                    <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel>Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="John Doe" {...field} />
                                    </FormControl>
                                    <FormMessage/>
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="email"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel>Email</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="email"
                                            placeholder="you@example.com"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage/>
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="password"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel>Password</FormLabel>
                                    <FormControl>
                                        <Input type="password" {...field} />
                                    </FormControl>
                                    <FormMessage/>
                                </FormItem>
                            )}
                        />

                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? "Creating account..." : "Sign up"}
                        </Button>
                    </form>
                </Form>

                <p className="mt-4 text-center text-sm text-muted-foreground">
                    Already have an account?{" "}
                    <Link to="/login" className="text-primary hover:underline">
                        Sign in
                    </Link>
                </p>
            </CardContent>
        </Card>
    );
}
