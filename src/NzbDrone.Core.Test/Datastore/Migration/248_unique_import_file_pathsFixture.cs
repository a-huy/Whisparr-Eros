using System;
using System.Linq;
using Dapper;
using FluentAssertions;
using NUnit.Framework;
using NzbDrone.Core.Datastore.Migration;
using NzbDrone.Core.RootFolders;
using NzbDrone.Core.Test.Framework;

namespace NzbDrone.Core.Test.Datastore.Migration
{
    [TestFixture]
    public class unique_import_file_pathsFixture : MigrationTest<unique_import_file_paths>
    {
        [Test]
        public void should_keep_oldest_identity_and_distinct_paths_and_root_folders()
        {
            using var db = WithDapperMigrationTestDb(m =>
            {
                for (var id = 1; id <= 3; id++)
                {
                    m.Insert.IntoTable("ImportFiles").Row(new { Id = id, RootFolderId = 1, Path = "/a/file.mkv", RelativePath = "file.mkv", Name = "file.mkv" });
                }

                m.Insert.IntoTable("ImportFiles").Row(new { Id = 4, RootFolderId = 1, Path = "/b/file.mkv", RelativePath = "b/file.mkv", Name = "file.mkv" });
                m.Insert.IntoTable("ImportFiles").Row(new { Id = 5, RootFolderId = 2, Path = "/a/file.mkv", RelativePath = "file.mkv", Name = "file.mkv" });
            });

            var rows = db.Query<ImportFile>("SELECT * FROM \"ImportFiles\" ORDER BY \"Id\"").ToList();
            rows.Select(f => f.Id).Should().Equal(1, 4, 5);
            rows[0].Path.Should().Be("/a/file.mkv");
            rows[0].RelativePath.Should().Be("file.mkv");
            rows[0].Name.Should().Be("file.mkv");

            Assert.Catch<Exception>(() => db.Execute("INSERT INTO \"ImportFiles\" (\"RootFolderId\", \"Path\", \"RelativePath\", \"Name\") VALUES (1, '/a/file.mkv', 'file.mkv', 'file.mkv')"));
        }
    }
}
