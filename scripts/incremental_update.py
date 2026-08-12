    backfill_enrichment = os.getenv("LLM_BACKFILL_ENRICHMENT", "true").lower() in {
        "1", "true", "yes", "on"
    }
