ALTER TABLE ai_classification_runs ADD COLUMN input_tokens INTEGER;
--> statement-breakpoint
ALTER TABLE ai_classification_runs ADD COLUMN output_tokens INTEGER;
--> statement-breakpoint
ALTER TABLE ai_classification_runs ADD COLUMN estimated_neurons INTEGER;
--> statement-breakpoint
ALTER TABLE ai_classification_runs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1;
