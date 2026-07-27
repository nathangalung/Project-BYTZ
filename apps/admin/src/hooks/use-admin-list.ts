import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiGet, type ListPage } from '@/lib/api'

const SEARCH_DEBOUNCE_MS = 300

type UseAdminListOptions = {
  queryKey: string
  path: string
  // Server-side filters owned by the hook so page resets stay in one place.
  initialFilters?: Record<string, string>
  pageSize?: number
}

export function useAdminList<T>({
  queryKey,
  path,
  initialFilters = {},
  pageSize = 100,
}: UseAdminListOptions) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState(initialFilters)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Narrowing the result set invalidates the current page number.
  function changeSearch(value: string) {
    setSearchInput(value)
    setPage(1)
  }

  function setFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
  }

  const query = useQuery({
    queryKey: [queryKey, filters, search, page, pageSize],
    queryFn: () => apiGet<ListPage<T>>(path, { ...filters, search, page, pageSize }),
  })

  return {
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    query,
    search: searchInput,
    setSearch: changeSearch,
    // Settled value; sibling queries must key off this, not the raw input.
    debouncedSearch: search,
    filters,
    setFilter,
    page,
    setPage,
    pageSize,
  }
}
