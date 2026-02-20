import {Link} from "react-router";
import {Plus} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage} from "@/components/ui/breadcrumb";
import {Page, PageActions, PageContent, PageHeader, PageTitle} from "@/components/common/layout/page";
import {StackList} from "@/components/domain/stack/stack-list";
import {useStacks} from "@/hooks/use-stacks";

export default function StacksPage() {
    const {stacks, loading, error} = useStacks();

    return (
        <Page>
            <PageHeader
                breadcrumbs={
                    <Breadcrumb>
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbPage>Stacks</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                }
            >
                <PageTitle>Stacks</PageTitle>
                <PageActions>
                    <Button asChild>
                        <Link to="/stacks/create">
                            <Plus className="h-4 w-4 mr-2" />
                            Create Stack
                        </Link>
                    </Button>
                </PageActions>
            </PageHeader>

            <PageContent>
                {error && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                <StackList stacks={stacks} loading={loading} />
            </PageContent>
        </Page>
    );
}
