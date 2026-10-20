import React from 'react';
import Label from 'Components/Label';
import { kinds } from 'Helpers/Props';
import MovieQuality from 'Movie/MovieQuality';
import PerformerBadges from 'Performer/PerformerBadges';
import { QualityModel } from 'Quality/Quality';
import { useUiSettingsValues } from 'Settings/UI/useUiSettings';
import getRelativeDate from 'Utilities/Date/getRelativeDate';
import translate from 'Utilities/String/translate';
import { ImportCredit } from '../../ImportMovieTypes';
import styles from './ImportMovieTitle.module.css';

interface ImportMovieTitleProps {
  itemType: string;
  title: string;
  year: number;
  releaseDate?: string;
  studioTitle?: string;
  performerNames?: string[];
  searchCredits?: ImportCredit[];
  isExistingMovie: boolean;
  existingHasFile?: boolean;
  existingQuality?: QualityModel;
  existingSize?: number;
}

function ImportMovieTitle({
  itemType,
  title,
  year,
  releaseDate,
  studioTitle,
  performerNames,
  searchCredits,
  isExistingMovie,
  existingHasFile,
  existingQuality,
  existingSize,
}: Readonly<ImportMovieTitleProps>) {
  const { shortDateFormat, showRelativeDates } = useUiSettingsValues();

  let itemDescr = title;

  if (itemType === 'movie' && year) {
    itemDescr = `${itemDescr} (${year})`;
  }

  return (
    <div className={styles.titleContainer}>
      {!!studioTitle && <Label>{studioTitle}</Label>}

      {!!releaseDate && itemType === 'scene' && (
        <Label>
          {getRelativeDate({
            date: releaseDate,
            shortDateFormat,
            showRelativeDates,
          })}
        </Label>
      )}

      <div className={styles.title}>{itemDescr}</div>

      <PerformerBadges credits={searchCredits} names={performerNames} />

      {/* One chip either way: an entry already in the library shows the quality it
          holds, or a Missing badge when the file is what it is waiting for. */}
      {isExistingMovie &&
        (existingHasFile && existingQuality ? (
          <MovieQuality
            quality={existingQuality}
            size={existingSize}
            title={translate('AlreadyInYourLibrary')}
          />
        ) : (
          <Label kind={kinds.DANGER} title={translate('InLibraryWithoutFile')}>
            {translate('Missing')}
          </Label>
        ))}
    </div>
  );
}

export default ImportMovieTitle;
