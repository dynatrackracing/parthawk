import React, { useEffect } from "react";
import {
  useTable,
  useSortBy,
  useGlobalFilter,
  usePagination,
  useRowSelect,
} from "react-table";
import Checkbox from "../Checkbox";
import GlobalFilter from "./GlobalFilter";

const CompatibilityTable = ({ data, columns, setSelectedRows }) => {
  const {
    getTableProps,
    getTableBodyProps,
    headerGroups,
    page,
    nextPage,
    previousPage,
    canNextPage,
    canPreviousPage,
    pageOptions,
    state,
    setGlobalFilter,
    selectedFlatRows,
    prepareRow,
  } = useTable(
    {
      columns,
      data,
    },
    useGlobalFilter,
    useSortBy,
    usePagination,
    useRowSelect,
    (hooks) => {
      hooks.visibleColumns.push((columns) => [
        {
          id: "selection",
          Header: ({ getToggleAllRowsSelectedProps }) => (
            <div>
              <Checkbox {...getToggleAllRowsSelectedProps()} />
            </div>
          ),
          Cell: ({ row }) => (
            <div>
              <Checkbox {...row.getToggleRowSelectedProps()} />
            </div>
          ),
        },
        ...columns,
      ]);
    }
  );

  const { pageIndex, globalFilter } = state;

  const ChevronDown = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="h-6 w-6"
      fill="none"
      viewBox="0 0 40 40"
      stroke="currentColor"
      style={{ position: "absolute", width: 40 }}
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M19 9l-7 7-7-7"
      />
    </svg>
  );

  const ChevronUp = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="h-6 w-6"
      fill="none"
      viewBox="0 0 40 40"
      stroke="currentColor"
      style={{ position: "absolute", width: 40 }}
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M5 15l7-7 7 7"
      />
    </svg>
  );

  useEffect(() => {
    setSelectedRows(selectedFlatRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFlatRows]);

  return (
<section class=" mx-auto font-mono">
  
  <GlobalFilter filter={globalFilter} setFilter={setGlobalFilter} />
  <div class="w-full mb-8 overflow-hidden rounded-lg shadow-lg">
      <div class="w-full overflow-x-auto">
        <table class="w-full" {...getTableProps()}>
          <thead>
            {headerGroups.map((headerGroup) => (
             <tr class="text-md font-semibold tracking-wide text-left text-gray-900 bg-gray-100 uppercase border-b border-gray-600" {...headerGroup.getHeaderGroupProps()}>
                {headerGroup.headers.slice(0, 1).map((column) => (
                  <th class="px-4 py-3 text-base" {...column.getHeaderProps(column.getSortByToggleProps())}>
                    {column.render("Header")}
                    {column.isSorted ? (
                      column.isSortedDesc ? (
                        <ChevronDown />
                      ) : (
                        <ChevronUp />
                      )
                    ) : (
                      ""
                    )}
                  </th>
                ))}
                <th class="px-4 py-3 text-base">#</th>
                {headerGroup.headers.slice(1).map((column) => (
                  <th class="px-4 py-3 text-base" {...column.getHeaderProps(column.getSortByToggleProps())}>
                    {column.render("Header")}
                    {column.isSorted ? (
                      column.isSortedDesc ? (
                        <ChevronDown />
                      ) : (
                        <ChevronUp />
                      )
                    ) : (
                      ""
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody class="bg-white" {...getTableBodyProps()}>
            {page.map((row, index) => {
              prepareRow(row);
              return (
                <tr class="text-gray-700" {...row.getRowProps()}>
                  {row.cells.slice(0, 1).map((cell) => {
                    return (
                      <td class="px-4 py-3 border" {...cell.getCellProps()}>{cell.render("Cell")}</td>
                    );
                  })}
                  <td class="px-4 py-3 border">{index + (10 * pageIndex + 1)}</td>
                  {row.cells.slice(1).map((cell) => {
                    return (
                      <td class="px-4 py-3 border" {...cell.getCellProps()}>{cell.render("Cell")}</td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
     
     

      <div
                        class="px-5 py-5 bg-white border-t flex flex-col xs:flex-row items-center xs:justify-between          ">
                        <div className=" font-semibold text-gray-400  mr-4">
          Page: {pageOptions.length === 0 ? 0 : pageIndex + 1} of{" "}
          {pageOptions.length}
        </div>
                        <div class="inline-flex mt-2 xs:mt-0">
                            <button    onClick={() => previousPage()}
            disabled={!canPreviousPage}
                                class="text-sm bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded-l">
                                 Prev
                            </button>
                            <button
                              onClick={() => nextPage()}
                              disabled={!canNextPage}
                                class="text-sm bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded-r">
                                Next
                            </button>
                        </div>
                    </div>
      </div>
    </section>
  );
};

export default CompatibilityTable;
