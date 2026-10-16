import { reduce } from 'lodash';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useParams } from 'react-router-dom';
import Alert from 'Components/Alert';
import LoadingIndicator from 'Components/Loading/LoadingIndicator';
import PageContent from 'Components/Page/PageContent';
import PageContentBody from 'Components/Page/PageContentBody';
import TablePager from 'Components/Table/TablePager';
import { kinds, sortDirections } from 'Helpers/Props';
import { SortDirection } from 'Helpers/Props/sortDirections';
import { useRootFolder } from 'RootFolder/useRootFolders';
import { useQualityProfiles } from 'Settings/Profiles/Quality/useQualityProfiles';
import ImportFile from 'typings/ImportFile';
import { SelectStateInputProps } from 'typings/props';
import { ApiError } from 'Utilities/Fetch/fetchJson';
import translate from 'Utilities/String/translate';
import {
  setAddMovieDefault,
  useAddMovieDefaults,
} from '../../addMovieDefaultsStore';
import {
  IMPORT_PAGE_SIZE,
  ImportItem,
  ImportItemType,
  importReducer,
  MovieLookupResult,
} from '../ImportMovieTypes';
import useImportLookupQueue from '../useImportLookupQueue';
import useImportMutation, { buildImportBody } from '../useImportMutation';
import ImportMovieFooter from './ImportMovieFooter';
import ImportMovieTable from './ImportMovieTable';

const EMPTY_IMPORT_FILES: ImportFile[] = [];

interface ImportMovieProps {
  readonly itemType?: ImportItemType;
}

interface SelectionState {
  allSelected: boolean;
  allUnselected: boolean;
  lastToggled: string | null;
  selectedState: Record<string, boolean>;
}

function getSelectedIds(selectedState: Record<string, boolean>): string[] {
  return reduce(
    selectedState,
    (result: string[], value, id) => {
      if (value) {
        result.push(id);
      }
      return result;
    },
    []
  );
}

function ImportMovie({ itemType }: ImportMovieProps) {
  const { rootFolderId: rootFolderIdParam } = useParams() as {
    rootFolderId: string;
  };
  const rootFolderId = Number.parseInt(rootFolderIdParam, 10);

  // The list endpoint already carries import files, but this page is reachable
  // by url with no list in the cache, so it reads the folder on its own.
  const {
    isFetching: rootFoldersFetching,
    isFetched: rootFoldersPopulated,
    error: rootFoldersError,
    data: rootFolder,
  } = useRootFolder(rootFolderId);

  const movieDefaults = useAddMovieDefaults();
  const { data: qualityProfiles } = useQualityProfiles();

  const defaultMonitor = movieDefaults.monitor ?? 'movieOnly';
  const defaultQualityProfileId = movieDefaults.qualityProfileId;

  const path = rootFolder?.path;
  const importFiles = rootFolder?.importFiles ?? EMPTY_IMPORT_FILES;

  // Ensure a valid quality profile default is set
  useEffect(() => {
    if (
      qualityProfiles.length > 0 &&
      (!defaultQualityProfileId ||
        !qualityProfiles.some((p) => p.id === defaultQualityProfileId))
    ) {
      setAddMovieDefault('qualityProfileId', qualityProfiles[0].id);
    }
  }, [defaultQualityProfileId, qualityProfiles]);

  const [importState, dispatch] = useReducer(importReducer, {
    isLookingUp: false,
    items: [],
  });

  const [selectionState, setSelectionState] = useState<SelectionState>({
    allSelected: false,
    allUnselected: false,
    lastToggled: null,
    selectedState: {},
  });

  const [sortDirection, setSortDirection] = useState<SortDirection>(
    sortDirections.ASCENDING
  );

  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<ApiError | null>(null);

  const { queueLookup, lookupUnsearched, cancelQueue, isLookingUp } =
    useImportLookupQueue(dispatch);

  const importMutation = useImportMutation(rootFolderId);

  const orderedFiles = useMemo(
    () =>
      [...importFiles].sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath, undefined, {
          numeric: true,
          sensitivity: 'base',
        })
      ),
    [importFiles]
  );
  const [page, setPage] = useState(1);
  const totalPages = Math.max(
    1,
    Math.ceil(importState.items.length / IMPORT_PAGE_SIZE)
  );
  const currentPage = Math.min(page, totalPages);

  // Initialise items when importFiles become available
  useEffect(() => {
    cancelQueue();
    setPage(1);
    setSelectionState({
      allSelected: false,
      allUnselected: true,
      lastToggled: null,
      selectedState: {},
    });
    dispatch({
      type: 'INIT_ITEMS',
      files: orderedFiles,
      itemType,
      defaults: {
        monitor: defaultMonitor,
        qualityProfileId: defaultQualityProfileId,
      },
    });
  }, [orderedFiles, itemType, cancelQueue]); // eslint-disable-line react-hooks/exhaustive-deps

  // The reducer keeps the initial path order, so lookup updates do not need
  // to sort the entire library again for each response.
  const sortedItems = useMemo(
    () =>
      sortDirection === sortDirections.DESCENDING
        ? [...importState.items].reverse()
        : importState.items,
    [importState.items, sortDirection]
  );
  const pageItems = useMemo(
    () =>
      sortedItems.slice(
        (currentPage - 1) * IMPORT_PAGE_SIZE,
        currentPage * IMPORT_PAGE_SIZE
      ),
    [sortedItems, currentPage]
  );
  const pageKey = JSON.stringify([
    rootFolderId,
    itemType,
    sortDirection,
    pageItems.map((item) => item.id),
  ]);

  useEffect(() => {
    cancelQueue();
    pageItems.forEach((item) => {
      if (!item.isPopulated && !item.error) {
        queueLookup({ id: item.id, term: item.term, itemType: item.itemType });
      }
    });
    return cancelQueue;
    // Restart only when page membership changes, not when its lookup results arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, queueLookup, cancelQueue]);

  useEffect(() => {
    setPage((previous) => Math.min(previous, totalPages));
  }, [totalPages]);

  // Selection belongs to the complete collection. Unmounting a page must not
  // remove its selections or make a previously unchecked match selected again.
  const previousItems = useRef(new Map<string, ImportItem>());
  useEffect(() => {
    const previous = previousItems.current;
    previousItems.current = new Map(
      importState.items.map((item) => [item.id, item])
    );
    setSelectionState((state) => {
      const selectedState: Record<string, boolean> = {};
      let changed =
        Object.keys(state.selectedState).length !== importState.items.length;
      importState.items.forEach((item) => {
        const old = previous.get(item.id);
        const newMatch = item.selectedMovie !== old?.selectedMovie;
        let isSelected = state.selectedState[item.id] ?? false;
        if (!item.selectedMovie) {
          isSelected = false;
        } else if (newMatch) {
          isSelected = !item.selectedMovie.isExisting;
        }
        selectedState[item.id] = isSelected;
        changed ||= selectedState[item.id] !== state.selectedState[item.id];
      });
      return changed ? { ...state, selectedState } : state;
    });
  }, [importState.items]);

  const allSelected =
    pageItems.length > 0 &&
    pageItems.every((item) => selectionState.selectedState[item.id]);
  const allUnselected = pageItems.every(
    (item) => !selectionState.selectedState[item.id]
  );
  const changePage = useCallback((value: number) => setPage(value), []);
  const onFirstPagePress = useCallback(() => setPage(1), []);
  const onPreviousPagePress = useCallback(
    () => setPage(currentPage - 1),
    [currentPage]
  );
  const onNextPagePress = useCallback(
    () => setPage(currentPage + 1),
    [currentPage]
  );
  const onLastPagePress = useCallback(() => setPage(totalPages), [totalPages]);

  const onSortPress = useCallback(() => {
    setPage(1);
    setSortDirection((prev) =>
      prev === sortDirections.ASCENDING
        ? sortDirections.DESCENDING
        : sortDirections.ASCENDING
    );
  }, []);

  const onSelectAllChange = useCallback(
    ({ value }: { value: boolean }) => {
      setSelectionState((previous) => {
        const selectedState = { ...previous.selectedState };
        pageItems.forEach((item) => {
          selectedState[item.id] = value && !!item.selectedMovie;
        });
        return { ...previous, selectedState, lastToggled: null };
      });
    },
    [pageItems]
  );

  const onSelectedChange = useCallback(
    ({ id, value, shiftKey }: SelectStateInputProps) => {
      setSelectionState((previous) => {
        const selectedState = { ...previous.selectedState, [id]: !!value };
        const start = pageItems.findIndex(
          (item) => item.id === previous.lastToggled
        );
        const end = pageItems.findIndex((item) => item.id === String(id));
        if (shiftKey && start >= 0 && end >= 0) {
          pageItems
            .slice(Math.min(start, end), Math.max(start, end) + 1)
            .forEach((item) => {
              selectedState[item.id] = !!value && !!item.selectedMovie;
            });
        }
        return { ...previous, selectedState, lastToggled: String(id) };
      });
    },
    [pageItems]
  );

  const onLookup = useCallback(
    (opts: {
      id: string;
      term: string;
      itemType?: ImportItemType;
      topOfQueue: boolean;
    }) => {
      queueLookup(opts);
    },
    [queueLookup]
  );

  const onMovieSelect = useCallback((id: string, movie: MovieLookupResult) => {
    dispatch({ type: 'SET_SELECTED_MOVIE', id, movie });
  }, []);

  const onItemValueChange = useCallback(
    (
      id: string,
      key: 'monitor' | 'qualityProfileId',
      value: string | number
    ) => {
      dispatch({ type: 'SET_ITEM_VALUE', id, key, value });
    },
    []
  );

  const onFooterInputChange = useCallback(
    ({ name, value }: { name: string; value: string | number }) => {
      const selectedIds = getSelectedIds(selectionState.selectedState);
      if (name === 'monitor') {
        setAddMovieDefault('monitor', value as string);
      } else if (name === 'qualityProfileId') {
        setAddMovieDefault('qualityProfileId', value as number);
      }
      selectedIds.forEach((id) => {
        dispatch({
          type: 'SET_ITEM_VALUE',
          id,
          key: name as 'monitor' | 'qualityProfileId',
          value,
        });
      });
    },
    [selectionState.selectedState]
  );

  const onImportPress = useCallback(async () => {
    const selectedIds = new Set(getSelectedIds(selectionState.selectedState));
    const selectedItems = importState.items.filter((item) =>
      selectedIds.has(item.id)
    );

    const body = buildImportBody(selectedItems);
    if (!body.length) {
      return;
    }

    setIsImporting(true);
    setImportError(null);

    try {
      await importMutation.mutateAsync(body);

      // Build set of item IDs that were successfully queued for import
      const importedForeignIds = new Set(body.map((m) => m.foreignId));
      const idsToRemove = selectedItems
        .filter(
          (i) =>
            i.selectedMovie && importedForeignIds.has(i.selectedMovie.foreignId)
        )
        .map((i) => i.id);

      idsToRemove.forEach((id) => {
        dispatch({ type: 'REMOVE_ITEM', id });
      });
    } catch (err) {
      setImportError(err as ApiError);
    } finally {
      setIsImporting(false);
    }
  }, [importMutation, importState.items, selectionState.selectedState]);

  const onLookupUnsearched = useCallback(() => {
    lookupUnsearched(pageItems);
  }, [pageItems, lookupUnsearched]);

  const onCancelLookup = useCallback(() => {
    cancelQueue();
  }, [cancelQueue]);

  const selectedIds = useMemo(
    () => getSelectedIds(selectionState.selectedState),
    [selectionState.selectedState]
  );

  let titleKey = 'ImportLibrary';

  if (itemType === 'scene') {
    titleKey = 'ImportScenes';
  } else if (itemType === 'movie') {
    titleKey = 'ImportMovies';
  }

  return (
    <PageContent title={translate(titleKey)}>
      <PageContentBody>
        {rootFoldersFetching ? <LoadingIndicator /> : null}

        {!rootFoldersFetching && !!rootFoldersError ? (
          <Alert kind={kinds.DANGER}>{translate('RootFoldersLoadError')}</Alert>
        ) : null}

        {!rootFoldersError &&
        !rootFoldersFetching &&
        rootFoldersPopulated &&
        !importFiles.length ? (
          <Alert kind={kinds.INFO}>
            {translate(
              itemType === 'scene'
                ? 'AllScenesInPathHaveBeenImported'
                : 'AllMoviesInPathHaveBeenImported',
              { path: path ?? '' }
            )}
          </Alert>
        ) : null}

        {!rootFoldersError &&
        !rootFoldersFetching &&
        rootFoldersPopulated &&
        !!importFiles.length ? (
          <ImportMovieTable
            items={pageItems}
            isLookingUp={isLookingUp}
            allSelected={allSelected}
            allUnselected={allUnselected}
            selectedState={selectionState.selectedState}
            sortDirection={sortDirection}
            onSortPress={onSortPress}
            onSelectAllChange={onSelectAllChange}
            onSelectedChange={onSelectedChange}
            onLookup={onLookup}
            onMovieSelect={onMovieSelect}
            onItemValueChange={onItemValueChange}
          />
        ) : null}
      </PageContentBody>

      {!rootFoldersError &&
      !rootFoldersFetching &&
      !!importState.items.length ? (
        <TablePager
          page={currentPage}
          totalPages={totalPages}
          totalRecords={importState.items.length}
          onFirstPagePress={onFirstPagePress}
          onPreviousPagePress={onPreviousPagePress}
          onNextPagePress={onNextPagePress}
          onLastPagePress={onLastPagePress}
          onPageSelect={changePage}
        />
      ) : null}

      {!rootFoldersError && !rootFoldersFetching && !!importFiles.length ? (
        <ImportMovieFooter
          items={importState.items}
          lookupItems={pageItems}
          selectedIds={selectedIds}
          defaultMonitor={defaultMonitor}
          defaultQualityProfileId={defaultQualityProfileId}
          isLookingUp={isLookingUp}
          isImporting={isImporting}
          importError={importError}
          onInputChange={onFooterInputChange}
          onImportPress={onImportPress}
          onLookupUnsearched={onLookupUnsearched}
          onCancelLookup={onCancelLookup}
        />
      ) : null}
    </PageContent>
  );
}

export default ImportMovie;
