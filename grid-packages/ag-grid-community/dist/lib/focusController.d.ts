import { BeanStub } from "./context/beanStub";
import { Column } from "./entities/column";
import { CellPosition } from "./entities/cellPosition";
import { RowNode } from "./entities/rowNode";
import { AbstractHeaderWrapper } from "./headerRendering/header/abstractHeaderWrapper";
import { HeaderPosition } from "./headerRendering/header/headerPosition";
import { ColumnGroup } from "./entities/columnGroup";
import { GridCore } from "./gridCore";
export declare class FocusController extends BeanStub {
    private readonly gridOptionsWrapper;
    private readonly columnController;
    private readonly headerNavigationService;
    private readonly columnApi;
    private readonly gridApi;
    private readonly rowRenderer;
    private readonly rowPositionUtils;
    private readonly rangeController;
    private static FOCUSABLE_SELECTOR;
    private static FOCUSABLE_EXCLUDE;
    private gridCore;
    private focusedCellPosition;
    private focusedHeaderPosition;
    private keyboardFocusActive;
    private init;
    registerGridCore(gridCore: GridCore): void;
    onColumnEverythingChanged(): void;
    isKeyboardFocus(): boolean;
    private activateMouseMode;
    private activateKeyboardMode;
    getFocusCellToUseAfterRefresh(): CellPosition | null;
    private getGridCellForDomElement;
    clearFocusedCell(): void;
    getFocusedCell(): CellPosition | null;
    setFocusedCell(rowIndex: number, colKey: string | Column, floating: string | null | undefined, forceBrowserFocus?: boolean): void;
    isCellFocused(cellPosition: CellPosition): boolean;
    isRowNodeFocused(rowNode: RowNode): boolean;
    isHeaderWrapperFocused(headerWrapper: AbstractHeaderWrapper): boolean;
    clearFocusedHeader(): void;
    getFocusedHeader(): HeaderPosition | null;
    setFocusedHeader(headerRowIndex: number, column: ColumnGroup | Column): void;
    focusHeaderPosition(headerPosition: HeaderPosition | null, direction?: 'Before' | 'After' | undefined | null, fromTab?: boolean, allowUserOverride?: boolean, event?: KeyboardEvent): boolean;
    isAnyCellFocused(): boolean;
    isRowFocused(rowIndex: number, floating?: string | null): boolean;
    findFocusableElements(rootNode: HTMLElement, exclude?: string | null, onlyUnmanaged?: boolean): HTMLElement[];
    focusInto(rootNode: HTMLElement, up?: boolean, onlyUnmanaged?: boolean): boolean;
    findNextFocusableElement(rootNode: HTMLElement, onlyManaged?: boolean | null, backwards?: boolean): HTMLElement | null;
    isFocusUnderManagedComponent(rootNode: HTMLElement): boolean;
    findTabbableParent(node: HTMLElement | null, limit?: number): HTMLElement | null;
    private onCellFocused;
    focusGridView(column?: Column, backwards?: boolean): boolean;
    focusNextGridCoreContainer(backwards: boolean): boolean;
}