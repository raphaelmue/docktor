import {Link} from "react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {Page, PageContent, PageHeader, PageTitle} from "@/components/common/layout/page";
import {BrownfieldImport} from "@/components/domain/stack/brownfield-import";
import {scanDirectories, adoptStack, previewMigration, executeMigration} from "@/lib/import-api";

// Post-setup entry point for brownfield scan/adopt/migrate (todo item M6).
// No wizard footer — adopting or migrating a stack is complete on its own,
// and BrownfieldImport's own "View stack" toast action is how the user
// moves on from here.
export default function ImportStackPage() {
  return (
    <Page>
      <PageHeader
        breadcrumbs={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/stacks">Stacks</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Import</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
      >
        <PageTitle>Import Existing Stack</PageTitle>
      </PageHeader>

      <PageContent>
        <BrownfieldImport
          api={{scanDirectories, adoptStack, previewMigration, executeMigration}}
        />
      </PageContent>
    </Page>
  );
}
