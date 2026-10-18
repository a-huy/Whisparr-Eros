using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Moq;
using NUnit.Framework;
using NzbDrone.Common.Disk;
using NzbDrone.Core.Movies;
using NzbDrone.Core.Organizer;
using NzbDrone.Core.RootFolders;
using NzbDrone.Core.Test.Framework;
using NzbDrone.Test.Common;

namespace NzbDrone.Core.Test.RootFolderTests
{
    [TestFixture]
    public class ImportRefreshFixture : CoreTest<RootFolderService>
    {
        private List<ImportFile> _stored;
        private string _folder;
        private string _file;

        [SetUp]
        public void Setup()
        {
            _folder = "/fixture".AsOsAgnostic();
            _file = Path.Combine(_folder, "import", "a", "file.mkv");
            _stored = new List<ImportFile>();
            Mocker.GetMock<IRootFolderRepository>().Setup(m => m.Get(1)).Returns(new RootFolder { Id = 1, Path = _folder });
            Mocker.GetMock<IDiskProvider>().Setup(m => m.FolderExists(It.IsAny<string>())).Returns(true);
            Mocker.GetMock<IDiskProvider>().Setup(m => m.GetFiles(It.IsAny<string>(), true)).Returns(() => new[] { _file });
            Mocker.GetMock<INamingConfigService>().Setup(m => m.GetConfig()).Returns(NamingConfig.Default);
            Mocker.GetMock<IMovieRepository>().Setup(m => m.AllMoviePaths()).Returns(new Dictionary<int, string>());
            Mocker.GetMock<IImportFileRepository>().Setup(m => m.FindByRootFolderId(1)).Returns(() => _stored.ToList());
            Mocker.GetMock<IImportFileRepository>().Setup(m => m.InsertMany(It.IsAny<IList<ImportFile>>()))
                .Callback<IList<ImportFile>>(files => _stored.AddRange(files));
        }

        [Test]
        public void should_insert_each_path_once_and_preserve_duplicate_basenames()
        {
            var other = Path.Combine(_folder, "import", "b", "file.mkv");
            Mocker.GetMock<IDiskProvider>().Setup(m => m.GetFiles(It.IsAny<string>(), true)).Returns(new[] { _file, _file, other });

            Subject.Refresh(1, false);
            Subject.Refresh(1, false);

            _stored.Select(f => f.Path).Should().BeEquivalentTo(_file, other);
            _stored.Select(f => f.Name).Should().OnlyContain(n => n == "file.mkv");
        }

        [Test]
        public void should_remove_only_paths_missing_from_disk()
        {
            _stored.Add(new ImportFile { Id = 7, RootFolderId = 1, Path = _file });
            _stored.Add(new ImportFile { Id = 8, RootFolderId = 1, Path = Path.Combine(_folder, "gone.mkv") });

            Subject.Refresh(1, false);

            Mocker.GetMock<IImportFileRepository>().Verify(m => m.DeleteMany(It.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new[] { 8 }))), Times.Once());
            _stored.Should().HaveCount(2);
        }

        [Test]
        public void should_release_refresh_lock_after_scan_failure()
        {
            Mocker.GetMock<IDiskProvider>().SetupSequence(m => m.GetFiles(It.IsAny<string>(), true))
                .Throws(new IOException("Scan failed"))
                .Returns(new[] { _file });

            Assert.Throws<IOException>(() => Subject.Refresh(1, false));
            var subject = Subject;
            var retry = Task.Run(() => subject.Refresh(1, false));
            retry.Wait(TimeSpan.FromSeconds(5)).Should().BeTrue();
            _stored.Should().ContainSingle();
        }

        [Test]
        public void should_serialize_overlapping_scans_before_reading_existing_records()
        {
            using var firstScan = new ManualResetEventSlim();
            using var releaseFirst = new ManualResetEventSlim();
            using var secondStarted = new ManualResetEventSlim();
            using var secondScan = new ManualResetEventSlim();
            var scans = 0;
            Mocker.GetMock<IDiskProvider>().Setup(m => m.GetFiles(It.IsAny<string>(), true)).Returns(() =>
            {
                if (Interlocked.Increment(ref scans) == 1)
                {
                    firstScan.Set();
                    if (!releaseFirst.Wait(TimeSpan.FromSeconds(10)))
                    {
                        throw new TimeoutException("First scan was not released");
                    }
                }
                else
                {
                    secondScan.Set();
                }

                return new[] { _file };
            });

            var subject = Subject;
            var first = Task.Factory.StartNew(() => subject.Refresh(1, false), CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
            var second = Task.CompletedTask;
            try
            {
                firstScan.Wait(TimeSpan.FromSeconds(5)).Should().BeTrue();
                second = Task.Factory.StartNew(
                    () =>
                    {
                        secondStarted.Set();
                        subject.Refresh(1, false);
                    },
                    CancellationToken.None,
                    TaskCreationOptions.LongRunning,
                    TaskScheduler.Default);

                secondStarted.Wait(TimeSpan.FromSeconds(5)).Should().BeTrue();
                secondScan.Wait(TimeSpan.FromMilliseconds(250)).Should().BeFalse();
            }
            finally
            {
                releaseFirst.Set();
                Task.WaitAll(new[] { first, second }, TimeSpan.FromSeconds(10)).Should().BeTrue();
            }

            scans.Should().Be(2);
            _stored.Should().ContainSingle().Which.Path.Should().Be(_file);
        }
    }
}
