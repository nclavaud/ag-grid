import { Column } from "../../entities/column";
import { CellChangedEvent, RowNode } from "../../entities/rowNode";
import { Constants } from "../../constants/constants";
import {
    CellClickedEvent,
    CellContextMenuEvent,
    CellDoubleClickedEvent,
    CellEditingStartedEvent,
    CellEvent,
    CellMouseOutEvent,
    CellMouseOverEvent,
    Events,
    FlashCellsEvent
} from "../../events";
import { Beans } from "./../beans";
import { Component } from "../../widgets/component";
import { ICellEditorComp, ICellEditorParams } from "../../interfaces/iCellEditor";
import { ICellRendererComp, ICellRendererParams } from "./../cellRenderers/iCellRenderer";
import { CheckboxSelectionComponent } from "./../checkboxSelectionComponent";
import { ColDef, NewValueParams } from "../../entities/colDef";
import { CellPosition } from "../../entities/cellPosition";
import { CellRangeType, ISelectionHandle, SelectionHandleType } from "../../interfaces/IRangeService";
import { RowCtrl } from "./../row/rowCtrl";
import { RowDragComp } from "./../row/rowDragComp";
import { PopupEditorWrapper } from "./../cellEditors/popupEditorWrapper";
import { AgPromise } from "../../utils";
import { IFrameworkOverrides } from "../../interfaces/iFrameworkOverrides";
import { DndSourceComp } from "./../dndSourceComp";
import { TooltipFeature, TooltipParentComp } from "../../widgets/tooltipFeature";
import { setAriaColIndex, setAriaDescribedBy, setAriaSelected } from "../../utils/aria";
import { get, getValueUsingField } from "../../utils/object";
import { escapeString } from "../../utils/string";
import { exists, missing } from "../../utils/generic";
import {
    addOrRemoveCssClass,
    addStylesToElement,
    clearElement,
    isElementChildOfClass,
    isFocusableFormField
} from "../../utils/dom";
import { areEqual, last } from "../../utils/array";
import { getTarget, isEventSupported, isStopPropagationForAgGrid } from "../../utils/event";
import { isEventFromPrintableCharacter } from "../../utils/keyboard";
import { isBrowserEdge, isBrowserIE, isIOSUserAgent } from "../../utils/browser";
import { doOnce } from "../../utils/function";
import { KeyCode } from '../../constants/keyCode';
import { ITooltipParams } from "./../tooltipComponent";
import { RowPosition } from "../../entities/rowPosition";
import {
    CellCtrl,
    CSS_CELL_INLINE_EDITING,
    CSS_CELL_NOT_INLINE_EDITING,
    CSS_CELL_POPUP_EDITING,
    CSS_CELL_VALUE,
    ICellComp
} from "./cellCtrl";

export class CellComp extends Component implements TooltipParentComp {

    public static DOM_DATA_KEY_CELL_COMP = 'cellComp';

    private static CELL_RENDERER_TYPE_NORMAL = 'cellRenderer';

    private eCellWrapper: HTMLElement;
    private eCellValue: HTMLElement;

    private beans: Beans;
    private column: Column;
    private rowNode: RowNode;
    private eRow: HTMLElement;

    private usingWrapper: boolean;

    private includeSelectionComponent: boolean;
    private includeRowDraggingComponent: boolean;
    private includeDndSourceComponent: boolean;

    private rowDraggingComp: RowDragComp | undefined;

    private editingCell = false;
    private cellEditorInPopup: boolean;
    private hideEditorPopup: Function | null;

    private createCellRendererFunc: (() => void) | null;

    private lastIPadMouseClickEvent: number;

    // instance of the cellRenderer class
    private cellRenderer: ICellRendererComp | null | undefined;
    private cellEditor: ICellEditorComp | null;

    private autoHeightCell: boolean;

    private rowCtrl: RowCtrl | null;

    private value: any;
    private valueFormatted: any;

    private suppressRefreshCell = false;

    private scope: any = null;

    private ctrl: CellCtrl;

    private readonly printLayout: boolean;

    // every time we go into edit mode, or back again, this gets incremented.
    // it's the components way of dealing with the async nature of framework components,
    // so if a framework component takes a while to be created, we know if the object
    // is still relevant when creating is finished. eg we could click edit / un-edit 20
    // times before the first React edit component comes back - we should discard
    // the first 19.
    private displayComponentVersion = 0;

    constructor(scope: any, beans: Beans, column: Column, rowNode: RowNode, rowComp: RowCtrl | null,
        autoHeightCell: boolean, printLayout: boolean, eRow: HTMLElement, editingRow: boolean) {
        super();
        this.scope = scope;
        this.beans = beans;
        this.column = column;
        this.rowNode = rowNode;
        this.rowCtrl = rowComp;
        this.autoHeightCell = autoHeightCell;
        this.printLayout = printLayout;
        this.eRow = eRow;

        // we need to do this early, as we need CellPosition before we call setComp()
        this.ctrl = new CellCtrl(column, rowNode, beans, rowComp);

        this.getValueAndFormat();
        this.setUsingWrapper();

        this.setTemplate(this.getCreateTemplate());

        const eGui = this.getGui();
        const style = eGui.style;

        const setAttribute = (name: string, value: string | null) => {
            if (value!=null && value!='') {
                eGui.setAttribute(name, value);
            } else {
                eGui.removeAttribute(name);
            }
        };

        const compProxy: ICellComp = {
            addOrRemoveCssClass: (cssClassName, on) => this.addOrRemoveCssClass(cssClassName, on),
            setUserStyles: styles => addStylesToElement(eGui, styles),
            setAriaSelected: selected => setAriaSelected(eGui, selected),
            getFocusableElement: ()=> this.getFocusableElement(),
            setLeft: left => style.left = left,
            setWidth: width => style.width = width,
            setAriaColIndex: index => setAriaColIndex(this.getGui(), index),
            setHeight: height => style.height = height,
            setZIndex: zIndex => style.zIndex = zIndex,
            setTabIndex: tabIndex => setAttribute('tabindex', tabIndex.toString()),
            setRole: role => setAttribute('role', role),
            setColId: colId => setAttribute('col-id', colId),
            setTitle: title => setAttribute('title', title),
            setUnselectable: value => setAttribute('unselectable', value),

            // temp items
            isEditing: ()=> this.editingCell,
            getValue: ()=> this.value,
            getValueFormatted: ()=> this.valueFormatted,
            setFocusOutOnEditor: ()=> this.setFocusOutOnEditor(),
            setFocusInOnEditor: ()=> this.setFocusInOnEditor(),
            stopRowOrCellEdit: ()=> this.stopRowOrCellEdit(),
            stopEditing: ()=> this.stopEditing(),
            startRowOrCellEdit: (keyPress, charPress)=> this.startRowOrCellEdit(keyPress, charPress),
            startEditingIfEnabled: (keyPress, charPress, cellStartedEdit)=> this.startEditingIfEnabled(keyPress, charPress, cellStartedEdit)
        };

        this.ctrl.setComp(compProxy, false, this.usingWrapper, this.scope, this.getGui(),
            this.printLayout);
        this.addDestroyFunc( ()=> this.ctrl.destroy() );

        // all of these have dependencies on the eGui, so only do them after eGui is set
        this.addDomData();
        this.populateTemplate();
        this.createCellRendererInstance(true);
        this.angular1Compile();
        this.ctrl.refreshHandle();


        // if we are editing the row, then the cell needs to turn
        // into edit mode
        if (editingRow) {
            this.startEditingIfEnabled();
        }
    }

    public getCtrl(): CellCtrl {
        return this.ctrl;
    }

    private getCreateTemplate(): string {
        const templateParts: string[] = [];

        const valueToRender = this.getInitialValueToRender();
        const valueSanitised = get(this.column, 'colDef.template', null) ? valueToRender : escapeString(valueToRender);

        templateParts.push(`<div comp-id="${this.getCompId()}">`);
        if (this.usingWrapper) {
            templateParts.push(this.getCellWrapperString(valueSanitised));
        } else if (valueSanitised != null) {
            templateParts.push(valueSanitised);
        }
        templateParts.push(`</div>`);

        return templateParts.join('');
    }

    private getCellWrapperString(value: string | null = ''): string {
        const unselectable = !this.beans.gridOptionsWrapper.isEnableCellTextSelection() ? ' unselectable="on"' : '';
        const wrapper = /* html */
        `<div ref="eCellWrapper" class="ag-cell-wrapper" role="presentation">
            <span ref="eCellValue" role="presentation" class="${CSS_CELL_VALUE}"${unselectable}>
                ${value != null ? value : ''}
            </span>
        </div>`;

        return wrapper;
    }

    public onColumnHover(): void {
        this.ctrl.onColumnHover();
    }

    public onCellChanged(event: CellChangedEvent): void {
        const eventImpactsThisCell = event.column === this.column;
        if (eventImpactsThisCell) {
            this.refreshCell({});
        }
    }


    public onFlashCells(event: FlashCellsEvent): void {
        const cellId = this.beans.cellPositionUtils.createId(this.ctrl.getCellPosition());
        const shouldFlash = event.cells[cellId];
        if (shouldFlash) {
            this.animateCell('highlight');
        }
    }

    private isUsingCellRenderer(): boolean {
        const colDef = this.column.getColDef();

        const usingAngular1Template = colDef.template!=null || colDef.templateUrl!=null;
        if (usingAngular1Template) {
            return false;
        }

        const res = colDef.cellRenderer != null
                 || colDef.cellRendererFramework != null
                 || colDef.cellRendererSelector != null;

        return res;
    }

    public getInitialValueToRender(): string {
        // if using a cellRenderer, then render blank cell
        if (this.isUsingCellRenderer()) {
            return '';
        }

        const colDef = this.getComponentHolder();

        if (colDef.template) {
            // template is really only used for angular 1 - as people using ng1 are used to providing templates with
            // bindings in it. in ng2, people will hopefully want to provide components, not templates.
            return colDef.template;
        }

        if (colDef.templateUrl) {
            // likewise for templateUrl - it's for ng1 really - when we move away from ng1, we can take these out.
            // niall was pro angular 1 when writing template and templateUrl, if writing from scratch now, would
            // not do these, but would follow a pattern that was friendly towards components, not templates.
            const template = this.beans.templateService.getTemplate(colDef.templateUrl, this.refreshCell.bind(this, true));

            return template || '';
        }

        return this.getValueToUse();
    }

    public getRenderedRow(): RowCtrl | null {
        return this.rowCtrl;
    }

    public getCellRenderer(): ICellRendererComp | null | undefined {
        return this.cellRenderer;
    }

    public getCellEditor(): ICellEditorComp | null {
        return this.cellEditor;
    }

    public updateRangeBordersIfRangeCount(): void {
        this.ctrl.updateRangeBordersIfRangeCount();
    }

    public onRangeSelectionChanged(): void {
        this.ctrl.onRangeSelectionChanged();
    }

    // + stop editing {forceRefresh: true, suppressFlash: true}
    // + event cellChanged {}
    // + cellRenderer.params.refresh() {} -> method passes 'as is' to the cellRenderer, so params could be anything
    // + rowComp: event dataChanged {animate: update, newData: !update}
    // + rowComp: api refreshCells() {animate: true/false}
    // + rowRenderer: api softRefreshView() {}
    public refreshCell(params?: { suppressFlash?: boolean, newData?: boolean, forceRefresh?: boolean; }) {
        // if we are in the middle of 'stopEditing', then we don't refresh here, as refresh gets called explicitly
        if (this.suppressRefreshCell || this.editingCell) { return; }

        const colDef = this.getComponentHolder();
        const newData = params && params.newData;
        const suppressFlash = (params && params.suppressFlash) || colDef.suppressCellFlash;
        // we always refresh if cell has no value - this can happen when user provides Cell Renderer and the
        // cell renderer doesn't rely on a value, instead it could be looking directly at the data, or maybe
        // printing the current time (which would be silly)???. Generally speaking
        // non of {field, valueGetter, showRowGroup} is bad in the users application, however for this edge case, it's
        // best always refresh and take the performance hit rather than never refresh and users complaining in support
        // that cells are not updating.
        const noValueProvided = colDef.field == null && colDef.valueGetter == null && colDef.showRowGroup == null;
        const forceRefresh = (params && params.forceRefresh) || noValueProvided || newData;

        const oldValue = this.value;

        // get latest value without invoking the value formatter as we may not be updating the cell
        this.value = this.getValue();

        // for simple values only (not objects), see if the value is the same, and if it is, skip the refresh.
        // when never allow skipping after an edit, as after editing, we need to put the GUI back to the way
        // if was before the edit.
        const valuesDifferent = !this.valuesAreEqual(oldValue, this.value);
        const dataNeedsUpdating = forceRefresh || valuesDifferent;

        if (dataNeedsUpdating) {
            // now invoke the value formatter as we are going to update cell
            this.valueFormatted = this.beans.valueFormatterService.formatValue(this.column, this.rowNode, this.scope, this.value);

            // if it's 'new data', then we don't refresh the cellRenderer, even if refresh method is available.
            // this is because if the whole data is new (ie we are showing stock price 'BBA' now and not 'SSD')
            // then we are not showing a movement in the stock price, rather we are showing different stock.
            const cellRendererRefreshed = newData ? false : this.attemptCellRendererRefresh();

            // we do the replace if not doing refresh, or if refresh was unsuccessful.
            // the refresh can be unsuccessful if we are using a framework (eg ng2 or react) and the framework
            // wrapper has the refresh method, but the underlying component doesn't
            if (!cellRendererRefreshed) {
                this.replaceContentsAfterRefresh();
            }

            // we don't want to flash the cells when processing a filter change, as otherwise the UI would
            // be to busy. see comment in FilterManager with regards processingFilterChange
            const processingFilterChange = this.beans.filterManager.isSuppressFlashingCellsBecauseFiltering();

            const flashCell = !suppressFlash && !processingFilterChange &&
                (this.beans.gridOptionsWrapper.isEnableCellChangeFlash() || colDef.enableCellChangeFlash);

            if (flashCell) {
                this.flashCell();
            }

            this.ctrl.temp_applyStyles();
            this.ctrl.temp_applyClasses();
        }

        // we can't readily determine if the data in an angularjs template has changed, so here we just update
        // and recompile (if applicable)
        this.updateAngular1ScopeAndCompile();

        this.ctrl.refreshToolTip();

        this.ctrl.temp_applyRules();
    }

    // user can also call this via API
    public flashCell(delays?: { flashDelay?: number | null; fadeDelay?: number | null; }): void {
        const flashDelay = delays && delays.flashDelay;
        const fadeDelay = delays && delays.fadeDelay;

        this.animateCell('data-changed', flashDelay, fadeDelay);
    }

    private animateCell(cssName: string, flashDelay?: number | null, fadeDelay?: number | null): void {
        const fullName = `ag-cell-${cssName}`;
        const animationFullName = `ag-cell-${cssName}-animation`;
        const element = this.getGui();
        const { gridOptionsWrapper } = this.beans;

        if (!flashDelay) {
            flashDelay = gridOptionsWrapper.getCellFlashDelay();
        }

        if (!exists(fadeDelay)) {
            fadeDelay = gridOptionsWrapper.getCellFadeDelay();
        }

        // we want to highlight the cells, without any animation
        this.addCssClass(fullName);
        this.removeCssClass(animationFullName);

        // then once that is applied, we remove the highlight with animation
        window.setTimeout(() => {
            this.removeCssClass(fullName);
            this.addCssClass(animationFullName);
            element.style.transition = `background-color ${fadeDelay}ms`;
            window.setTimeout(() => {
                // and then to leave things as we got them, we remove the animation
                this.removeCssClass(animationFullName);
                element.style.removeProperty('transition');
            }, fadeDelay!);
        }, flashDelay);
    }

    private replaceContentsAfterRefresh(): void {
        this.setUsingWrapper();
        clearElement(this.eCellValue);

        // remove old renderer component if it exists
        this.cellRenderer = this.beans.context.destroyBean(this.cellRenderer);

        // populate
        this.putDataIntoCellAfterRefresh();
        this.updateAngular1ScopeAndCompile();
    }

    private updateAngular1ScopeAndCompile() {
        if (this.beans.gridOptionsWrapper.isAngularCompileRows() && this.scope) {
            this.scope.data = { ...this.rowNode.data };
            this.angular1Compile();
        }
    }

    private angular1Compile(): void {
        // if angular compiling, then need to also compile the cell again (angular compiling sucks, please wait...)
        if (this.beans.gridOptionsWrapper.isAngularCompileRows()) {
            const eGui = this.getGui();

            // only compile the node if it hasn't already been done
            // this prevents "orphaned" node leaks
            if (!eGui.classList.contains('ng-scope') || eGui.childElementCount === 0) {
                const compiledElement = this.beans.$compile(eGui)(this.scope);
                this.addDestroyFunc(() => compiledElement.remove());
            }
        }
    }

    private putDataIntoCellAfterRefresh() {
        // template gets preference, then cellRenderer, then do it ourselves
        const colDef = this.getComponentHolder();

        if (colDef.template) {
            // template is really only used for angular 1 - as people using ng1 are used to providing templates with
            // bindings in it. in ng2, people will hopefully want to provide components, not templates.
            this.eCellValue.innerHTML = colDef.template;
        } else if (colDef.templateUrl) {
            // likewise for templateUrl - it's for ng1 really - when we move away from ng1, we can take these out.
            // niall was pro angular 1 when writing template and templateUrl, if writing from scratch now, would
            // not do these, but would follow a pattern that was friendly towards components, not templates.
            const template = this.beans.templateService.getTemplate(colDef.templateUrl, this.refreshCell.bind(this, true));

            if (template) {
                this.eCellValue.innerHTML = template;
            }
        } else {
            if (this.isUsingCellRenderer()) {
                this.createCellRendererInstance();
            } else {
                const valueToUse = this.getValueToUse();

                if (valueToUse != null) {
                    this.eCellValue.innerHTML = escapeString(valueToUse) || '';
                }
            }
        }
    }

    public attemptCellRendererRefresh(): boolean {
        if (missing(this.cellRenderer) || !this.cellRenderer || missing(this.cellRenderer.refresh)) {
            return false;
        }

        // if the cell renderer has a refresh method, we call this instead of doing a refresh
        const params = this.createCellRendererParams();

        // take any custom params off of the user
        const finalParams = this.beans.userComponentFactory.createFinalParams(this.getComponentHolder(), CellComp.CELL_RENDERER_TYPE_NORMAL, params);

        const result: boolean | void = this.cellRenderer.refresh(finalParams);

        // NOTE on undefined: previous version of the cellRenderer.refresh() interface
        // returned nothing, if the method existed, we assumed it refreshed. so for
        // backwards compatibility, we assume if method exists and returns nothing,
        // that it was successful.
        return result === true || result === undefined;
    }

    private valuesAreEqual(val1: any, val2: any): boolean {
        // if the user provided an equals method, use that, otherwise do simple comparison
        const colDef = this.getComponentHolder();
        const equalsMethod = colDef ? colDef.equals : null;

        return equalsMethod ? equalsMethod(val1, val2) : val1 === val2;
    }


    // a wrapper is used when we are putting a selection checkbox in the cell with the value
    public setUsingWrapper(): void {
        const colDef = this.getComponentHolder();

        // never allow selection or dragging on pinned rows
        if (this.rowNode.rowPinned) {
            this.usingWrapper = false;
            this.includeSelectionComponent = false;
            this.includeRowDraggingComponent = false;
            this.includeDndSourceComponent = false;
            return;
        }

        const cbSelectionIsFunc = typeof colDef.checkboxSelection === 'function';
        const rowDraggableIsFunc = typeof colDef.rowDrag === 'function';
        const dndSourceIsFunc = typeof colDef.dndSource === 'function';

        this.includeSelectionComponent = cbSelectionIsFunc || colDef.checkboxSelection === true;
        this.includeRowDraggingComponent = rowDraggableIsFunc || colDef.rowDrag === true;
        this.includeDndSourceComponent = dndSourceIsFunc || colDef.dndSource === true;

        // text selection requires the value to be wrapped in anoter element
        const enableTextSelection = this.beans.gridOptionsWrapper.isEnableCellTextSelection();

        this.usingWrapper = enableTextSelection || this.includeRowDraggingComponent || this.includeSelectionComponent || this.includeDndSourceComponent;
    }

    private createCellRendererInstance(useTaskService = false): void {
        // never use task service if angularCompileRows=true, as that assume the cell renderers
        // are finished when the row is created. also we never use it if animation frame service
        // is turned off.
        // and lastly we never use it if doing auto-height, as the auto-height service checks the
        // row height directly after the cell is created, it doesn't wait around for the tasks to complete
        const angularCompileRows = this.beans.gridOptionsWrapper.isAngularCompileRows();
        const suppressAnimationFrame = this.beans.gridOptionsWrapper.isSuppressAnimationFrame();

        if (angularCompileRows || suppressAnimationFrame || this.autoHeightCell) { useTaskService = false; }

        const params = this.createCellRendererParams();

        this.displayComponentVersion++;

        const callback = this.afterCellRendererCreated.bind(this, this.displayComponentVersion);

        this.createCellRendererFunc = () => {
            this.createCellRendererFunc = null;
            // this can return null in the event that the user has switched from a renderer component to nothing, for example
            // when using a cellRendererSelect to return a component or null depending on row data etc
            const componentPromise = this.beans.userComponentFactory.newCellRenderer(this.getComponentHolder(), params);
            if (componentPromise) {
                componentPromise.then(callback);
            }
        };

        if (useTaskService) {
            this.beans.taskQueue.createTask(this.createCellRendererFunc, this.rowNode.rowIndex!, 'createTasksP2');
        } else {
            this.createCellRendererFunc();
        }
    }

    private afterCellRendererCreated(cellRendererVersion: number, cellRenderer: ICellRendererComp): void {
        const cellRendererNotRequired = !this.isAlive() || cellRendererVersion !== this.displayComponentVersion;

        if (cellRendererNotRequired) {
            this.beans.context.destroyBean(cellRenderer);
            return;
        }

        this.cellRenderer = cellRenderer;
        const eGui = this.cellRenderer.getGui();
        if (eGui!=null) {
            this.eCellValue.appendChild(eGui);
        }
    }

    private createCellRendererParams(): ICellRendererParams {
        return {
            value: this.value,
            valueFormatted: this.valueFormatted,
            getValue: this.getValue.bind(this),
            setValue: value => this.beans.valueService.setValue(this.rowNode, this.column, value),
            formatValue: this.formatValue.bind(this),
            data: this.rowNode.data,
            node: this.rowNode,
            colDef: this.getComponentHolder(),
            column: this.column,
            $scope: this.scope,
            rowIndex: this.ctrl.getCellPosition().rowIndex,
            api: this.beans.gridOptionsWrapper.getApi(),
            columnApi: this.beans.gridOptionsWrapper.getColumnApi(),
            context: this.beans.gridOptionsWrapper.getContext(),
            refreshCell: this.refreshCell.bind(this),

            eGridCell: this.getGui(),
            eParentOfValue: this.eCellValue,

            registerRowDragger: (rowDraggerElement, dragStartPixels) => this.addRowDragging(rowDraggerElement, dragStartPixels),

            // these bits are not documented anywhere, so we could drop them?
            // it was in the olden days to allow user to register for when rendered
            // row was removed (the row comp was removed), however now that the user
            // can provide components for cells, the destroy method gets call when this
            // happens so no longer need to fire event.
            addRowCompListener: this.rowCtrl ? this.rowCtrl.addEventListener.bind(this.rowCtrl) : null,
            addRenderedRowListener: (eventType: string, listener: Function) => {
                console.warn('AG Grid: since AG Grid .v11, params.addRenderedRowListener() is now params.addRowCompListener()');
                if (this.rowCtrl) {
                    this.rowCtrl.addEventListener(eventType, listener);
                }
            }
        } as ICellRendererParams;
    }

    private formatValue(value: any): any {
        const valueFormatted = this.beans.valueFormatterService.formatValue(this.column, this.rowNode, this.scope, value);

        return valueFormatted != null ? valueFormatted : value;
    }

    private getValueToUse(): any {
        return this.valueFormatted != null ? this.valueFormatted : this.value;
    }

    private getValueAndFormat(): void {
        this.value = this.getValue();
        this.valueFormatted = this.beans.valueFormatterService.formatValue(this.column, this.rowNode, this.scope, this.value);
    }

    private getValue(): any {
        // if we don't check this, then the grid will render leaf groups as open even if we are not
        // allowing the user to open leaf groups. confused? remember for pivot mode we don't allow
        // opening leaf groups, so we have to force leafGroups to be closed in case the user expanded
        // them via the API, or user user expanded them in the UI before turning on pivot mode
        const lockedClosedGroup = this.rowNode.leafGroup && this.beans.columnModel.isPivotMode();

        const isOpenGroup = this.rowNode.group && this.rowNode.expanded && !this.rowNode.footer && !lockedClosedGroup;

        // are we showing group footers
        const groupFootersEnabled = this.beans.gridOptionsWrapper.isGroupIncludeFooter();

        // if doing footers, we normally don't show agg data at group level when group is open
        const groupAlwaysShowAggData = this.beans.gridOptionsWrapper.isGroupSuppressBlankHeader();

        // if doing grouping and footers, we don't want to include the agg value
        // in the header when the group is open
        const ignoreAggData = (isOpenGroup && groupFootersEnabled) && !groupAlwaysShowAggData;

        const value = this.beans.valueService.getValue(this.column, this.rowNode, false, ignoreAggData);

        return value;
    }

    public onMouseEvent(eventName: string, mouseEvent: MouseEvent): void {
        if (isStopPropagationForAgGrid(mouseEvent)) { return; }

        switch (eventName) {
            case 'click':
                this.onCellClicked(mouseEvent);
                break;
            case 'mousedown':
                this.onMouseDown(mouseEvent);
                break;
            case 'dblclick':
                this.onCellDoubleClicked(mouseEvent);
                break;
            case 'mouseout':
                this.onMouseOut(mouseEvent);
                break;
            case 'mouseover':
                this.onMouseOver(mouseEvent);
                break;
        }
    }

    public dispatchCellContextMenuEvent(event: Event | null) {
        const colDef = this.getComponentHolder();
        const cellContextMenuEvent: CellContextMenuEvent = this.createEvent(event, Events.EVENT_CELL_CONTEXT_MENU);
        this.beans.eventService.dispatchEvent(cellContextMenuEvent);

        if (colDef.onCellContextMenu) {
            // to make the callback async, do in a timeout
            window.setTimeout(() => (colDef.onCellContextMenu as any)(cellContextMenuEvent), 0);
        }
    }

    public createEvent(domEvent: Event | null, eventType: string): CellEvent {
        const event: CellEvent = {
            type: eventType,
            node: this.rowNode,
            data: this.rowNode.data,
            value: this.value,
            column: this.column,
            colDef: this.getComponentHolder(),
            context: this.beans.gridOptionsWrapper.getContext(),
            api: this.beans.gridApi,
            columnApi: this.beans.columnApi,
            rowPinned: this.rowNode.rowPinned,
            event: domEvent,
            rowIndex: this.rowNode.rowIndex!
        };

        // because we are hacking in $scope for angular 1, we have to de-reference
        if (this.scope) {
            (event as any).$scope = this.scope;
        }

        return event;
    }

    private onMouseOut(mouseEvent: MouseEvent): void {
        const cellMouseOutEvent: CellMouseOutEvent = this.createEvent(mouseEvent, Events.EVENT_CELL_MOUSE_OUT);
        this.beans.eventService.dispatchEvent(cellMouseOutEvent);
        this.beans.columnHoverService.clearMouseOver();
    }

    private onMouseOver(mouseEvent: MouseEvent): void {
        const cellMouseOverEvent: CellMouseOverEvent = this.createEvent(mouseEvent, Events.EVENT_CELL_MOUSE_OVER);
        this.beans.eventService.dispatchEvent(cellMouseOverEvent);
        this.beans.columnHoverService.setMouseOver([this.column]);
    }

    private onCellDoubleClicked(mouseEvent: MouseEvent) {
        const colDef = this.getComponentHolder();
        // always dispatch event to eventService
        const cellDoubleClickedEvent: CellDoubleClickedEvent = this.createEvent(mouseEvent, Events.EVENT_CELL_DOUBLE_CLICKED);
        this.beans.eventService.dispatchEvent(cellDoubleClickedEvent);

        // check if colDef also wants to handle event
        if (typeof colDef.onCellDoubleClicked === 'function') {
            // to make the callback async, do in a timeout
            window.setTimeout(() => (colDef.onCellDoubleClicked as any)(cellDoubleClickedEvent), 0);
        }

        const editOnDoubleClick = !this.beans.gridOptionsWrapper.isSingleClickEdit()
            && !this.beans.gridOptionsWrapper.isSuppressClickEdit();
        if (editOnDoubleClick) {
            this.startRowOrCellEdit();
        }
    }

    // called by rowRenderer when user navigates via tab key
    public startRowOrCellEdit(keyPress?: number | null, charPress?: string | null): void {
        if (this.beans.gridOptionsWrapper.isFullRowEdit()) {
            this.rowCtrl!.startRowEditing(keyPress, charPress, this);
        } else {
            this.startEditingIfEnabled(keyPress, charPress, true);
        }
    }

    public isCellEditable() {
        return this.column.isCellEditable(this.rowNode);
    }

    // either called internally if single cell editing, or called by rowRenderer if row editing
    public startEditingIfEnabled(keyPress: number | null = null, charPress: string | null = null, cellStartedEdit = false): void {
        // don't do it if not editable
        if (!this.isCellEditable()) { return; }

        // don't do it if already editing
        if (this.editingCell) { return; }

        this.editingCell = true;

        this.displayComponentVersion++;
        const callback = this.afterCellEditorCreated.bind(this, this.displayComponentVersion);

        const params = this.createCellEditorParams(keyPress, charPress, cellStartedEdit);
        this.createCellEditor(params).then(callback);

        // if we don't do this, and editor component is async, then there will be a period
        // when the component isn't present and keyboard navigation won't work - so example
        // of user hitting tab quickly (more quickly than renderers getting created) won't work
        const cellEditorAsync = missing(this.cellEditor);

        if (cellEditorAsync && cellStartedEdit) {
            this.ctrl.focusCell(true);
        }
    }

    private createCellEditor(params: ICellEditorParams): AgPromise<ICellEditorComp> {
        const cellEditorPromise = this.beans.userComponentFactory.newCellEditor(this.column.getColDef(), params);

        return cellEditorPromise!.then(cellEditor => {
            const cellEditorComp = cellEditor!;
            const isPopup = cellEditorComp.isPopup && cellEditorComp.isPopup();

            if (!isPopup) { return cellEditorComp; }

            if (this.beans.gridOptionsWrapper.isFullRowEdit()) {
                console.warn('AG Grid: popup cellEditor does not work with fullRowEdit - you cannot use them both ' +
                    '- either turn off fullRowEdit, or stop using popup editors.');
            }

            // if a popup, then we wrap in a popup editor and return the popup
            const popupEditorWrapper = new PopupEditorWrapper(cellEditorComp);
            this.beans.context.createBean(popupEditorWrapper);
            popupEditorWrapper.init(params);

            return popupEditorWrapper;
        });
    }

    private afterCellEditorCreated(cellEditorVersion: number, cellEditor: ICellEditorComp): void {

        // if editingCell=false, means user cancelled the editor before component was ready.
        // if versionMismatch, then user cancelled the edit, then started the edit again, and this
        //   is the first editor which is now stale.
        const versionMismatch = cellEditorVersion !== this.displayComponentVersion;

        const cellEditorNotNeeded = versionMismatch || !this.editingCell;
        if (cellEditorNotNeeded) {
            this.beans.context.destroyBean(cellEditor);
            return;
        }

        const editingCancelledByUserComp = cellEditor.isCancelBeforeStart && cellEditor.isCancelBeforeStart();
        if (editingCancelledByUserComp) {
            this.beans.context.destroyBean(cellEditor);
            this.editingCell = false;
            return;
        }

        if (!cellEditor.getGui) {
            console.warn(`AG Grid: cellEditor for column ${this.column.getId()} is missing getGui() method`);

            // no getGui, for React guys, see if they attached a react component directly
            if ((cellEditor as any).render) {
                console.warn(`AG Grid: we found 'render' on the component, are you trying to set a React renderer but added it as colDef.cellEditor instead of colDef.cellEditorFmk?`);
            }

            this.beans.context.destroyBean(cellEditor);
            this.editingCell = false;

            return;
        }

        this.cellEditor = cellEditor;

        this.cellEditorInPopup = cellEditor.isPopup !== undefined && cellEditor.isPopup();
        this.setInlineEditingClass();

        if (this.cellEditorInPopup) {
            this.addPopupCellEditor();
        } else {
            this.addInCellEditor();
        }

        if (cellEditor.afterGuiAttached) {
            cellEditor.afterGuiAttached();
        }

        const event: CellEditingStartedEvent = this.createEvent(null, Events.EVENT_CELL_EDITING_STARTED);
        this.beans.eventService.dispatchEvent(event);
    }

    private addInCellEditor(): void {
        const eGui = this.getGui();

        // if focus is inside the cell, we move focus to the cell itself
        // before removing it's contents, otherwise errors could be thrown.
        if (eGui.contains(document.activeElement)) {
            eGui.focus();
        }

        this.clearCellElement();
        this.cellRenderer = this.beans.context.destroyBean(this.cellRenderer);

        eGui.appendChild(this.cellEditor!.getGui());

        this.angular1Compile();
    }

    private addPopupCellEditor(): void {
        const ePopupGui = this.cellEditor && this.cellEditor.getGui();

        if (!ePopupGui) { return; }

        const popupService = this.beans.popupService;

        const useModelPopup = this.beans.gridOptionsWrapper.isStopEditingWhenCellsLoseFocus();

        const position = this.cellEditor && this.cellEditor.getPopupPosition ? this.cellEditor.getPopupPosition() : 'over';

        const params = {
            column: this.column,
            rowNode: this.rowNode,
            type: 'popupCellEditor',
            eventSource: this.getGui(),
            ePopup: ePopupGui,
            keepWithinBounds: true
        };

        const positionCallback = position === 'under' ?
            popupService.positionPopupUnderComponent.bind(popupService, params)
            : popupService.positionPopupOverComponent.bind(popupService, params);

        const addPopupRes = popupService.addPopup({
            modal: useModelPopup,
            eChild: ePopupGui,
            closeOnEsc: true,
            closedCallback: () => { this.onPopupEditorClosed(); },
            anchorToElement: this.getGui(),
            positionCallback
        });
        if (addPopupRes) {
            this.hideEditorPopup = addPopupRes.hideFunc;
        }

        this.angular1Compile();
    }

    private onPopupEditorClosed(): void {
        // we only call stopEditing if we are editing, as
        // it's possible the popup called 'stop editing'
        // before this, eg if 'enter key' was pressed on
        // the editor.

        if (!this.editingCell) { return; }
        // note: this only happens when use clicks outside of the grid. if use clicks on another
        // cell, then the editing will have already stopped on this cell
        this.stopRowOrCellEdit();
    }

    // if we are editing inline, then we don't have the padding in the cell (set in the themes)
    // to allow the text editor full access to the entire cell
    private setInlineEditingClass(): void {
        if (!this.isAlive()) { return; }

        // ag-cell-inline-editing - appears when user is inline editing
        // ag-cell-not-inline-editing - appears when user is no inline editing
        // ag-cell-popup-editing - appears when user is editing cell in popup (appears on the cell, not on the popup)

        // note: one of {ag-cell-inline-editing, ag-cell-not-inline-editing} is always present, they toggle.
        //       however {ag-cell-popup-editing} shows when popup, so you have both {ag-cell-popup-editing}
        //       and {ag-cell-not-inline-editing} showing at the same time.

        const editingInline = this.editingCell && !this.cellEditorInPopup;
        const popupEditorShowing = this.editingCell && this.cellEditorInPopup;

        this.addOrRemoveCssClass(CSS_CELL_INLINE_EDITING, editingInline);
        this.addOrRemoveCssClass(CSS_CELL_NOT_INLINE_EDITING, !editingInline);
        this.addOrRemoveCssClass(CSS_CELL_POPUP_EDITING, popupEditorShowing);
        addOrRemoveCssClass(this.getGui().parentNode as HTMLElement, "ag-row-inline-editing", editingInline);
        addOrRemoveCssClass(this.getGui().parentNode as HTMLElement, "ag-row-not-inline-editing", !editingInline);
    }

    private createCellEditorParams(keyPress: number | null, charPress: string | null, cellStartedEdit: boolean): ICellEditorParams {
        return {
            value: this.getValue(),
            keyPress: keyPress,
            charPress: charPress,
            column: this.column,
            colDef: this.column.getColDef(),
            rowIndex: this.ctrl.getCellPosition().rowIndex,
            node: this.rowNode,
            data: this.rowNode.data,
            api: this.beans.gridOptionsWrapper.getApi(),
            cellStartedEdit: cellStartedEdit,
            columnApi: this.beans.gridOptionsWrapper.getColumnApi(),
            context: this.beans.gridOptionsWrapper.getContext(),
            $scope: this.scope,
            onKeyDown: this.onKeyDown.bind(this),
            stopEditing: this.stopEditingAndFocus.bind(this),
            eGridCell: this.getGui(),
            parseValue: this.parseValue.bind(this),
            formatValue: this.formatValue.bind(this)
        };
    }

    // cell editors call this, when they want to stop for reasons other
    // than what we pick up on. eg selecting from a dropdown ends editing.
    private stopEditingAndFocus(suppressNavigateAfterEdit = false): void {
        this.stopRowOrCellEdit();
        this.ctrl.focusCell(true);

        if (!suppressNavigateAfterEdit) {
            this.navigateAfterEdit();
        }
    }

    private parseValue(newValue: any): any {
        const colDef = this.getComponentHolder();
        const params: NewValueParams = {
            node: this.rowNode,
            data: this.rowNode.data,
            oldValue: this.value,
            newValue: newValue,
            colDef: colDef,
            column: this.column,
            api: this.beans.gridOptionsWrapper.getApi(),
            columnApi: this.beans.gridOptionsWrapper.getColumnApi(),
            context: this.beans.gridOptionsWrapper.getContext()
        };

        const valueParser = colDef.valueParser;

        return exists(valueParser) ? this.beans.expressionService.evaluate(valueParser, params) : newValue;
    }

    public setFocusInOnEditor(): void {
        if (this.editingCell) {
            if (this.cellEditor && this.cellEditor.focusIn) {
                // if the editor is present, then we just focus it
                this.cellEditor.focusIn();
            } else {
                // if the editor is not present, it means async cell editor (eg React fibre)
                // and we are trying to set focus before the cell editor is present, so we
                // focus the cell instead
                this.ctrl.focusCell(true);
            }
        }
    }

    public isEditing(): boolean {
        return this.editingCell;
    }

    public onKeyDown(event: KeyboardEvent): void {
        const key = event.which || event.keyCode;

        switch (key) {
            case KeyCode.ENTER:
                this.onEnterKeyDown(event);
                break;
            case KeyCode.F2:
                this.onF2KeyDown();
                break;
            case KeyCode.ESCAPE:
                this.onEscapeKeyDown();
                break;
            case KeyCode.TAB:
                this.onTabKeyDown(event);
                break;
            case KeyCode.BACKSPACE:
            case KeyCode.DELETE:
                this.onBackspaceOrDeleteKeyPressed(key);
                break;
            case KeyCode.DOWN:
            case KeyCode.UP:
            case KeyCode.RIGHT:
            case KeyCode.LEFT:
                this.onNavigationKeyPressed(event, key);
                break;
        }
    }

    public setFocusOutOnEditor(): void {
        if (this.editingCell && this.cellEditor && this.cellEditor.focusOut) {
            this.cellEditor.focusOut();
        }
    }

    private onNavigationKeyPressed(event: KeyboardEvent, key: number): void {
        if (this.editingCell) { return; }

        if (event.shiftKey && this.ctrl.temp_isRangeSelectionEnabled()) {
            this.onShiftRangeSelect(key);
        } else {
            this.beans.navigationService.navigateToNextCell(event, key, this.ctrl.getCellPosition(), true);
        }

        // if we don't prevent default, the grid will scroll with the navigation keys
        event.preventDefault();
    }

    private onShiftRangeSelect(key: number): void {
        if (!this.beans.rangeService) { return; }

        const endCell = this.beans.rangeService.extendLatestRangeInDirection(key);

        if (endCell) {
            this.beans.navigationService.ensureCellVisible(endCell);
        }
    }

    private onTabKeyDown(event: KeyboardEvent): void {
        this.beans.navigationService.onTabKeyDown(this.ctrl, event);
    }

    private onBackspaceOrDeleteKeyPressed(key: number): void {
        if (!this.editingCell) {
            this.startRowOrCellEdit(key);
        }
    }

    private onEnterKeyDown(e: KeyboardEvent): void {
        if (this.editingCell || this.rowCtrl!.isEditing()) {
            this.stopEditingAndFocus();
        } else {
            if (this.beans.gridOptionsWrapper.isEnterMovesDown()) {
                this.beans.navigationService.navigateToNextCell(null, KeyCode.DOWN, this.ctrl.getCellPosition(), false);
            } else {
                this.startRowOrCellEdit(KeyCode.ENTER);
                if (this.editingCell) {
                    // if we started editing, then we need to prevent default, otherwise the Enter action can get
                    // applied to the cell editor. this happened, for example, with largeTextCellEditor where not
                    // preventing default results in a 'new line' character getting inserted in the text area
                    // when the editing was started
                    e.preventDefault();
                }
            }
        }
    }

    private navigateAfterEdit(): void {
        const fullRowEdit = this.beans.gridOptionsWrapper.isFullRowEdit();

        if (fullRowEdit) { return; }

        const enterMovesDownAfterEdit = this.beans.gridOptionsWrapper.isEnterMovesDownAfterEdit();

        if (enterMovesDownAfterEdit) {
            this.beans.navigationService.navigateToNextCell(null, KeyCode.DOWN, this.ctrl.getCellPosition(), false);
        }
    }

    private onF2KeyDown(): void {
        if (!this.editingCell) {
            this.startRowOrCellEdit(KeyCode.F2);
        }
    }

    private onEscapeKeyDown(): void {
        if (this.editingCell) {
            this.stopRowOrCellEdit(true);
            this.ctrl.focusCell(true);
        }
    }

    public onKeyPress(event: KeyboardEvent): void {
        // check this, in case focus is on a (for example) a text field inside the cell,
        // in which cse we should not be listening for these key pressed
        const eventTarget = getTarget(event);
        const eventOnChildComponent = eventTarget !== this.getGui();

        if (eventOnChildComponent || this.editingCell) { return; }

        const pressedChar = String.fromCharCode(event.charCode);
        if (pressedChar === ' ') {
            this.onSpaceKeyPressed(event);
        } else if (isEventFromPrintableCharacter(event)) {
            this.startRowOrCellEdit(null, pressedChar);
            // if we don't prevent default, then the keypress also gets applied to the text field
            // (at least when doing the default editor), but we need to allow the editor to decide
            // what it wants to do. we only do this IF editing was started - otherwise it messes
            // up when the use is not doing editing, but using rendering with text fields in cellRenderer
            // (as it would block the the user from typing into text fields).
            event.preventDefault();
        }
    }

    private onSpaceKeyPressed(event: KeyboardEvent): void {
        const { gridOptionsWrapper } = this.beans;

        if (!this.editingCell && gridOptionsWrapper.isRowSelection()) {
            const currentSelection = this.rowNode.isSelected();
            const newSelection = !currentSelection;
            if (newSelection || !gridOptionsWrapper.isSuppressRowDeselection()) {
                const groupSelectsFiltered = this.beans.gridOptionsWrapper.isGroupSelectsFiltered();
                const updatedCount = this.rowNode.setSelectedParams({
                    newValue: newSelection,
                    rangeSelect: event.shiftKey,
                    groupSelectsFiltered: groupSelectsFiltered
                });
                if (currentSelection === undefined && updatedCount === 0) {
                    this.rowNode.setSelectedParams({
                        newValue: false,
                        rangeSelect: event.shiftKey,
                        groupSelectsFiltered: groupSelectsFiltered
                    });
                }
            }
        }

        // prevent default as space key, by default, moves browser scroll down
        event.preventDefault();
    }

    private onMouseDown(mouseEvent: MouseEvent): void {
        const { ctrlKey, metaKey, shiftKey } = mouseEvent;
        const target = mouseEvent.target as HTMLElement;
        const { eventService, rangeService } = this.beans;

        // do not change the range for right-clicks inside an existing range
        if (this.isRightClickInExistingRange(mouseEvent)) {
            return;
        }

        if (!shiftKey || (rangeService && !rangeService.getCellRanges().length)) {
            // We only need to pass true to focusCell when the browser is IE/Edge and we are trying
            // to focus the cell itself. This should never be true if the mousedown was triggered
            // due to a click on a cell editor for example.
            const forceBrowserFocus = (isBrowserIE() || isBrowserEdge()) && !this.editingCell && !isFocusableFormField(target);

            this.ctrl.focusCell(forceBrowserFocus);
        } else if (rangeService) {
            // if a range is being changed, we need to make sure the focused cell does not change.
            mouseEvent.preventDefault();
        }

        // if we are clicking on a checkbox, we need to make sure the cell wrapping that checkbox
        // is focused but we don't want to change the range selection, so return here.
        if (this.containsWidget(target)) { return; }

        if (rangeService) {
            const thisCell = this.ctrl.getCellPosition();

            if (shiftKey) {
                rangeService.extendLatestRangeToCell(thisCell);
            } else {
                const ctrlKeyPressed = ctrlKey || metaKey;
                rangeService.setRangeToCell(thisCell, ctrlKeyPressed);
            }
        }

        eventService.dispatchEvent(this.createEvent(mouseEvent, Events.EVENT_CELL_MOUSE_DOWN));
    }

    private isRightClickInExistingRange(mouseEvent: MouseEvent): boolean {
        const { rangeService } = this.beans;

        if (rangeService) {
            const cellInRange = rangeService.isCellInAnyRange(this.getCellPosition());

            if (cellInRange && mouseEvent.button === 2) {
                return true;
            }
        }

        return false;
    }

    private containsWidget(target: HTMLElement): boolean {
        return isElementChildOfClass(target, 'ag-selection-checkbox', 3);
    }

    // returns true if on iPad and this is second 'click' event in 200ms
    private isDoubleClickOnIPad(): boolean {
        if (!isIOSUserAgent() || isEventSupported('dblclick')) { return false; }

        const nowMillis = new Date().getTime();
        const res = nowMillis - this.lastIPadMouseClickEvent < 200;
        this.lastIPadMouseClickEvent = nowMillis;

        return res;
    }

    private onCellClicked(mouseEvent: MouseEvent): void {
        // iPad doesn't have double click - so we need to mimic it to enable editing for iPad.
        if (this.isDoubleClickOnIPad()) {
            this.onCellDoubleClicked(mouseEvent);
            mouseEvent.preventDefault(); // if we don't do this, then iPad zooms in

            return;
        }

        const { eventService, gridOptionsWrapper } = this.beans;

        const cellClickedEvent: CellClickedEvent = this.createEvent(mouseEvent, Events.EVENT_CELL_CLICKED);
        eventService.dispatchEvent(cellClickedEvent);

        const colDef = this.getComponentHolder();

        if (colDef.onCellClicked) {
            // to make callback async, do in a timeout
            window.setTimeout(() => colDef.onCellClicked!(cellClickedEvent), 0);
        }

        const editOnSingleClick = (gridOptionsWrapper.isSingleClickEdit() || colDef.singleClickEdit)
            && !gridOptionsWrapper.isSuppressClickEdit();

        if (editOnSingleClick) {
            this.startRowOrCellEdit();
        }
    }

    public getCellPosition(): CellPosition {
        return this.ctrl.getCellPosition();
    }

    public getColumn(): Column {
        return this.column;
    }

    public getComponentHolder(): ColDef {
        return this.column.getColDef();
    }

    public detach(): void {
        this.eRow.removeChild(this.getGui());
    }

    // if the row is also getting destroyed, then we don't need to remove from dom,
    // as the row will also get removed, so no need to take out the cells from the row
    // if the row is going (removing is an expensive operation, so only need to remove
    // the top part)
    //
    // note - this is NOT called by context, as we don't wire / unwire the CellComp for performance reasons.
    public destroy(): void {
        if (this.createCellRendererFunc) {
            this.beans.taskQueue.cancelTask(this.createCellRendererFunc);
        }

        this.stopEditing();
        this.cellRenderer = this.beans.context.destroyBean(this.cellRenderer);

        super.destroy();
    }

    public onNewColumnsLoaded(): void {
        this.ctrl.temp_applyOnNewColumnsLoaded();
    }

    public onFirstRightPinnedChanged(): void {
        this.ctrl.onFirstRightPinnedChanged();
    }

    public onLastLeftPinnedChanged(): void {
        this.ctrl.onLastLeftPinnedChanged();
    }

    public refreshShouldDestroy(): boolean {
        const isUsingWrapper = this.usingWrapper;
        const isIncludingRowDragging = this.includeRowDraggingComponent;
        const isIncludingDndSource = this.includeDndSourceComponent;
        const isIncludingSelection = this.includeSelectionComponent;

        this.setUsingWrapper();

        return isUsingWrapper !== this.usingWrapper ||
            isIncludingRowDragging !== this.includeRowDraggingComponent ||
            isIncludingDndSource !== this.includeDndSourceComponent ||
            isIncludingSelection !== this.includeSelectionComponent;
    }

    private populateTemplate(): void {
        if (this.usingWrapper) {

            this.eCellValue = this.getRefElement('eCellValue');
            this.eCellWrapper = this.getRefElement('eCellWrapper');
            this.eCellValue.id = `cell-${this.getCompId()}`;
            let describedByIds = '';

            if (this.includeRowDraggingComponent) {
                this.addRowDragging();
            }

            if (this.includeDndSourceComponent) {
                this.addDndSource();
            }

            if (this.includeSelectionComponent) {
                describedByIds += this.addSelectionCheckbox().getCheckboxId();
            }

            setAriaDescribedBy(this.getGui(), `${describedByIds} ${this.eCellValue.id}`.trim());
        } else {
            this.eCellValue = this.getGui();
            this.eCellWrapper = this.eCellValue;
        }
    }

    protected getFrameworkOverrides(): IFrameworkOverrides {
        return this.beans.frameworkOverrides;
    }

    private addRowDragging(customElement?: HTMLElement, dragStartPixels?: number): void {
        const pagination = this.beans.gridOptionsWrapper.isPagination();
        const rowDragManaged = this.beans.gridOptionsWrapper.isRowDragManaged();
        const clientSideRowModelActive = this.beans.gridOptionsWrapper.isRowModelDefault();

        if (rowDragManaged) {
            // row dragging only available in default row model
            if (!clientSideRowModelActive) {
                doOnce(() => console.warn('AG Grid: managed row dragging is only allowed in the Client Side Row Model'),
                    'CellComp.addRowDragging');

                return;
            }

            if (pagination) {
                doOnce(() => console.warn('AG Grid: managed row dragging is not possible when doing pagination'),
                    'CellComp.addRowDragging');

                return;
            }
        }
        if (!this.rowDraggingComp) {
            this.rowDraggingComp = new RowDragComp(() => this.value, this.rowNode, this.column, customElement, dragStartPixels);
            this.createManagedBean(this.rowDraggingComp, this.beans.context);
        } else if (customElement) {
            // if the rowDraggingComp is already present, means we should only set the drag element
            this.rowDraggingComp.setDragElement(customElement, dragStartPixels);
        }

        // If there is a custom element, the Cell Renderer is responsible for displaying it.
        if (!customElement) {
            // put the checkbox in before the value
            this.eCellWrapper.insertBefore(this.rowDraggingComp.getGui(), this.eCellValue);
        }
    }

    private addDndSource(): void {
        const dndSourceComp = new DndSourceComp(this.rowNode, this.column, this.beans, this.getGui());
        this.createManagedBean(dndSourceComp, this.beans.context);

        // put the checkbox in before the value
        this.eCellWrapper.insertBefore(dndSourceComp.getGui(), this.eCellValue);
    }

    private addSelectionCheckbox(): CheckboxSelectionComponent {
        const cbSelectionComponent = new CheckboxSelectionComponent();
        this.beans.context.createBean(cbSelectionComponent);

        cbSelectionComponent.init({ rowNode: this.rowNode, column: this.column });
        this.addDestroyFunc(() => this.beans.context.destroyBean(cbSelectionComponent));

        // put the checkbox in before the value
        this.eCellWrapper.insertBefore(cbSelectionComponent.getGui(), this.eCellValue);
        return cbSelectionComponent;
    }

    private addDomData(): void {
        const element = this.getGui();
        this.beans.gridOptionsWrapper.setDomData(element, CellComp.DOM_DATA_KEY_CELL_COMP, this);

        this.addDestroyFunc(() => this.beans.gridOptionsWrapper.setDomData(element, CellComp.DOM_DATA_KEY_CELL_COMP, null));
    }

    // pass in 'true' to cancel the editing.
    public stopRowOrCellEdit(cancel: boolean = false) {
        if (this.beans.gridOptionsWrapper.isFullRowEdit()) {
            this.rowCtrl!.stopRowEditing(cancel);
        } else {
            this.stopEditing(cancel);
        }
    }

    public stopEditing(cancel = false): void {
        if (!this.editingCell) { return; }

        // if no cell editor, this means due to async, that the cell editor never got initialised,
        // so we just carry on regardless as if the editing was never started.
        if (!this.cellEditor) {
            this.editingCell = false;
            return;
        }

        const oldValue = this.getValue();
        let newValueExists = false;
        let newValue: any;

        if (!cancel) {
            // also have another option here to cancel after editing, so for example user could have a popup editor and
            // it is closed by user clicking outside the editor. then the editor will close automatically (with false
            // passed above) and we need to see if the editor wants to accept the new value.
            const userWantsToCancel = this.cellEditor.isCancelAfterEnd && this.cellEditor.isCancelAfterEnd();

            if (!userWantsToCancel) {
                newValue = this.cellEditor.getValue();
                newValueExists = true;
            }
        }

        // it is important we set this after setValue() above, as otherwise the cell will flash
        // when editing stops. the 'refresh' method checks editing, and doesn't refresh editing cells.
        // thus it will skip the refresh on this cell until the end of this method where we call
        // refresh directly and we suppress the flash.
        this.editingCell = false;

        // important to clear this out - as parts of the code will check for
        // this to see if an async cellEditor has yet to be created
        this.beans.context.destroyBean(this.cellEditor);
        this.cellEditor = null;

        if (this.cellEditorInPopup && this.hideEditorPopup) {
            this.hideEditorPopup();
            this.hideEditorPopup = null;
        } else {
            this.clearCellElement();
            const eGui = this.getGui();
            // put the cell back the way it was before editing
            if (this.usingWrapper) {
                // if wrapper, then put the wrapper back
                eGui.appendChild(this.eCellWrapper);
            }
        }

        this.setInlineEditingClass();
        this.ctrl.refreshHandle();

        if (newValueExists && newValue !== oldValue) {
            // we suppressRefreshCell because the call to rowNode.setDataValue() results in change detection
            // getting triggered, which results in all cells getting refreshed. we do not want this refresh
            // to happen on this call as we want to call it explicitly below. otherwise refresh gets called twice.
            // if we only did this refresh (and not the one below) then the cell would flash and not be forced.
            this.suppressRefreshCell = true;
            this.rowNode.setDataValue(this.column, newValue);
            this.suppressRefreshCell = false;
        }

        // we suppress the flash, as it is not correct to flash the cell the user has finished editing,
        // the user doesn't need to flash as they were the one who did the edit, the flash is pointless
        // (as the flash is meant to draw the user to a change that they didn't manually do themselves).
        this.refreshCell({ forceRefresh: true, suppressFlash: true });

        const editingStoppedEvent = {
            ...this.createEvent(null, Events.EVENT_CELL_EDITING_STOPPED),
            oldValue,
            newValue
        };

        this.beans.eventService.dispatchEvent(editingStoppedEvent);
    }

    private clearCellElement(): void {
        const eGui = this.getGui();

        // if focus is inside the cell, we move focus to the cell itself
        // before removing it's contents, otherwise errors could be thrown.
        if (eGui.contains(document.activeElement) && !isBrowserIE()) {
            eGui.focus({
                preventScroll: true
            });
        }

        clearElement(eGui);
    }
}
