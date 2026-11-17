import { formatNumber } from '../i18n';

/** Integer with the digit grouping of the interface language (30,000 / 30 000 / 30.000). */
export const formatInt = (n: number): string => formatNumber(n);
