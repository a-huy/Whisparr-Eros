using FluentMigrator;
using NzbDrone.Core.Datastore.Migration.Framework;

namespace NzbDrone.Core.Datastore.Migration
{
    [Migration(248)]
    public class unique_import_file_paths : NzbDroneMigrationBase
    {
        protected override void MainDbUpgrade()
        {
            // Retain the oldest identity for each candidate; this table only catalogs files.
            Execute.Sql(@"DELETE FROM ""ImportFiles""
                WHERE ""Id"" NOT IN (
                    SELECT MIN(""Id"") FROM ""ImportFiles"" GROUP BY ""RootFolderId"", ""Path"")");

            Create.Index("IX_ImportFiles_RootFolderId_Path")
                .OnTable("ImportFiles")
                .OnColumn("RootFolderId").Ascending()
                .OnColumn("Path").Ascending()
                .WithOptions().Unique();
        }
    }
}
