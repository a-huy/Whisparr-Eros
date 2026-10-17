interface SceneCandidate {
  foreignId: string;
  itemType: string;
  title: string;
  studioTitle?: string;
  releaseDate?: string;
  isExcluded?: boolean;
  performerNames?: string[];
  searchCredits?: {
    personName?: string;
    type?: string;
    performer?: { name?: string };
  }[];
}

function words(value: string) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseSceneFilename(path: string) {
  const filename = path.split(/[\\/]/).pop() ?? '';
  const stem = filename.replace(/\.(?:mp4|mkv|avi|mov|wmv|m4v|ts|webm)$/i, '');
  const parsed = stem.match(
    /^(.+?)[._ -]+((?:19|20)\d{2}|\d{2})[._-](\d{2})[._-](\d{2})[._ -]+(.+)$/
  );

  if (!parsed) {
    return null;
  }

  const [, site, year, month, day, content] = parsed;
  // Two-digit release years use the current catalog era. Older/ambiguous dates
  // stay unselected when they do not agree with the catalog's full date.
  const date = `${year.length === 2 ? '20' : ''}${year}-${month}-${day}`;
  const timestamp = new Date(`${date}T00:00:00Z`);

  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString().slice(0, 10) !== date
  ) {
    return null;
  }

  return { site, date, content };
}

// Broaden retrieval by dropping the filename date and site token. The result
// still has to pass the original file's site/date/credit checks below.
export function getSceneLookupTerm(path: string) {
  const parsed = parseSceneFilename(path);
  return parsed ? words(parsed.content) : null;
}

// This deliberately recognizes only the simple dated scene filenames. Unknown
// layouts, aliases and partial names need a human choice rather than a guess.
export default function getAutomaticSceneMatch<T extends SceneCandidate>(
  path: string,
  candidates: readonly T[]
): T | null {
  const parsed = parseSceneFilename(path);

  if (!parsed) {
    return null;
  }

  const { site, date, content } = parsed;

  const matches = new Map<string, T>();
  candidates.forEach((candidate) => {
    if (
      candidate.itemType !== 'scene' ||
      candidate.isExcluded ||
      !candidate.foreignId ||
      words(site).replaceAll(' ', '') !==
        words(candidate.studioTitle ?? '').replaceAll(' ', '') ||
      candidate.releaseDate?.slice(0, 10) !== date
    ) {
      return;
    }

    const title = words(
      candidate.title.replace(/\s*[-–:]?\s*S\d+\s*:?\s*E\d+\s*$/i, '')
    );
    let remaining = words(content);
    const cast = [
      ...(candidate.performerNames ?? []),
      ...(candidate.searchCredits ?? [])
        .filter((credit) => credit.type === 'cast')
        .map((credit) => credit.personName ?? credit.performer?.name ?? ''),
    ]
      .map(words)
      // A first name by itself does not establish a performer identity.
      .filter((name) => name.includes(' '))
      .sort((a, b) => b.length - a.length);

    let matchedPerformer = false;

    while (remaining) {
      const current = remaining;
      const name = cast.find(
        (value) => current === value || current.startsWith(`${value} `)
      );

      if (!name) {
        break;
      }

      matchedPerformer = true;
      remaining = remaining.slice(name.length).trim();

      if (remaining.startsWith('and ')) {
        remaining = remaining.slice(4);
      }
    }

    if (
      (remaining && remaining === title) ||
      (matchedPerformer && !remaining)
    ) {
      matches.set(candidate.foreignId, candidate);
    }
  });

  return matches.size === 1 ? [...matches.values()][0] : null;
}
