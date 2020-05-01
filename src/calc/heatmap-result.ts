import { Result, Model, Sector, Indicator } from "../webapi";

export class HeatmapResult {

    private normalized: number[][];
    private shares: number[][];

    static async from(model: Model, result: Result): Promise<HeatmapResult> {
        const [sectors, r] = await aggregateByRegions(result, model);
        return new HeatmapResult(sectors, r);
    }

    constructor(public sectors: Sector[], public result: Result) {
        this.normalized = result.data.map((row, i) => {
            const total = result.totals[i];
            return row.map(x => {
                return !total || !x
                    ? 0
                    : x / total;
            });
        });

        // calculate the result shares
        const maxIndicatorValues = this.normalized.map(
            row => (!row || row.length === 0)
                ? 0
                : row.reduce((max, x) => Math.max(max, Math.abs(x)), 0)
        );
        this.shares = this.normalized.map((row, i) => {
            const max = maxIndicatorValues[i];
            return (!row || row.length === 0)
                ? []
                : row.map(x => {
                    if (x === 0) {
                        return 0;
                    }
                    if (max === 0) {
                        return x >= 0 ? 100 : -100;
                    }
                    return 100 * x / max;
                });
        });
    }

    /**
     * Returns the result value for the given sector and indicator.
     */
    public getResult(indicator: Indicator, sector: Sector): number {
        if (!indicator || !sector) {
            return 0;
        }
        return this.value(this.result.data, indicator.index, sector.index);
    }

    public getShare(indicator: Indicator, sector: Sector): number {
        if (!indicator || !sector) {
            return 0;
        }
        return this.value(this.shares, indicator.index, sector.index);
    }

    public getRanking(indicators: Indicator[], count: number, nameFilter: string): Sector[] {
        let filter = null;
        if (nameFilter && nameFilter.trim().length > 0) {
            filter = nameFilter.trim().toLocaleLowerCase();
        }
        const ranks: [Sector, number][] = [];
        for (const sector of this.sectors) {
            if (!this.matchesFilter(sector, filter)) {
                continue;
            }
            ranks.push([
                sector,
                this.getRankingValue(sector, indicators),
            ]);
        }
        ranks.sort((r1, r2) => r2[1] - r1[1]);
        return ranks.slice(0, count).map(r => r[0]);
    }

    private matchesFilter(sector: Sector, filter?: string): boolean {
        if (!filter) {
            return true;
        }
        if (!sector || !sector.name) {
            return false;
        }
        const name = sector.name.toLocaleLowerCase();
        return name.indexOf(filter) >= 0;
    }

    private getRankingValue(sector: Sector, indicators: Indicator[]): number {
        const column = sector.index;
        return indicators.reduce((sum, indicator) =>
            sum + this.value(this.normalized, indicator.index, column), 0);
    }

    private value(data: number[][], row: number, column: number): number {
        if (!data) {
            return 0;
        }
        if (row < 0 || row >= data.length) {
            return 0;
        }
        const xs = data[row];
        if (column < 0 || column >= xs.length) {
            return 0;
        }
        return xs[column];
    }
}

/**
 * If the given result is a multi-regional model, this function aggregates the
 * given result so that the result columns of the same sector in different
 * regions are summed up to a single column. Together with the aggregated result
 * a corresponding sector array is returned but this sector information should
 * be **never** used for API requests as they describe an artificialy aggregated
 * sector. If the given model describes a single region, the result and sectors
 * are returned without modification.
 */
async function aggregateByRegions(result: Result, model: Model): Promise<[Sector[], Result]> {
    const isMultiRegional = await model.isMultiRegional();
    if (!isMultiRegional) {
        return [await model.sectors(), result];
    }

    // generate the aggregated sectors and map their
    // codes to their index: code => index
    const sectors = await model.sectors();
    const aggSectors: Sector[] = [];
    const aggSectorIds: string[] = [];
    const sectorIdx: { [code: string]: number } = {};
    let idx = 0;
    for (const s of sectors) {
        if (sectorIdx[s.code] === undefined) {
            sectorIdx[s.code] = idx;
            const agg: Sector = {
                code: s.code,
                id: `${s.code}/${s.name}`.toLocaleLowerCase(),
                index: idx,
                name: s.name,
                description: s.description,
                location: null,
            };
            aggSectors[idx] = agg;
            aggSectorIds[idx] = agg.id;
            idx++;
        }
    }

    // aggregate the result matrix
    const data: number[][] = result.data.map(row => {
        const aggRow = new Array(aggSectors.length).fill(0);
        sectors.forEach((sector) => {
            const j = sectorIdx[sector.code];
            aggRow[j] += row[sector.index];
        });
        return aggRow;
    });

    return [aggSectors, {
        data,
        indicators: result.indicators,
        sectors: aggSectorIds,
        totals: result.totals,
    }];
}
