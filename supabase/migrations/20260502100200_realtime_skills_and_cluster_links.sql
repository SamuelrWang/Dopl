-- Add skills, skill_files, and the new cluster→KB/skill junction tables
-- to the supabase_realtime publication so client subscribers receive
-- INSERT/UPDATE/DELETE events. Mirrors what knowledge_bases /
-- knowledge_folders / knowledge_entries already opted into.

ALTER PUBLICATION supabase_realtime ADD TABLE skills;
ALTER PUBLICATION supabase_realtime ADD TABLE skill_files;
ALTER PUBLICATION supabase_realtime ADD TABLE cluster_knowledge_bases;
ALTER PUBLICATION supabase_realtime ADD TABLE cluster_skills;
