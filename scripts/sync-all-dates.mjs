import { execFileSync } from "node:child_process"
import path from "node:path"
import { connect } from "framer-api"

const requiredVariables = [
  "FRAMER_PROJECT_URL",
  "FRAMER_API_KEY",
  "FRAMER_COLLECTION_ID",
  "FRAMER_SOURCE_FILENAME_FIELD_ID",
  "FRAMER_LAST_UPDATED_FIELD_ID",
]

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`Missing required environment variable: ${variable}`)
  }
}

const {
  FRAMER_PROJECT_URL: projectUrl,
  FRAMER_API_KEY: apiKey,
  FRAMER_COLLECTION_ID: collectionId,
  FRAMER_SOURCE_FILENAME_FIELD_ID: sourceFilenameFieldId,
  FRAMER_LAST_UPDATED_FIELD_ID: lastUpdatedFieldId,
} = process.env

const applyChanges =
  String(process.env.APPLY_CHANGES).toLowerCase() === "true"

function readFieldValue(fieldData) {
  if (
    fieldData &&
    typeof fieldData === "object" &&
    "value" in fieldData
  ) {
    return fieldData.value
  }

  return fieldData
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase()
}

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "pdfs"],
  { encoding: "utf8" }
)
  .split(/\r?\n/)
  .map(file => file.trim())
  .filter(file => file.toLowerCase().endsWith(".pdf"))

if (trackedFiles.length === 0) {
  throw new Error("No tracked PDF files were found under pdfs/")
}

const repositoryFiles = new Map()

for (const file of trackedFiles) {
  const basename = path.basename(file)
  const key = normalize(basename)

  if (repositoryFiles.has(key)) {
    throw new Error(
      `Duplicate PDF basename: ${basename}\n` +
      `${repositoryFiles.get(key)}\n${file}`
    )
  }

  const gitDate = execFileSync(
    "git",
    ["log", "-1", "--format=%cI", "--", file],
    { encoding: "utf8" }
  ).trim()

  if (!gitDate) {
    throw new Error(`No Git history found for: ${file}`)
  }

  repositoryFiles.set(key, {
    basename,
    file,
    isoDate: new Date(gitDate).toISOString(),
  })
}

const framer = await connect(projectUrl, apiKey)

try {
  const collection = await framer.getCollection(collectionId)

  if (!collection) {
    throw new Error(`Framer collection not found: ${collectionId}`)
  }

  const items = await collection.getItems()
  const matches = []
  const unmatchedCmsItems = []

  for (const item of items) {
    const sourceFilename = readFieldValue(
      item.fieldData?.[sourceFilenameFieldId]
    )

    if (!sourceFilename) {
      unmatchedCmsItems.push({
        slug: item.slug,
        reason: "Source Filename is empty",
      })
      continue
    }

    const repositoryFile = repositoryFiles.get(
      normalize(sourceFilename)
    )

    if (!repositoryFile) {
      unmatchedCmsItems.push({
        slug: item.slug,
        reason: `No repository PDF matches "${sourceFilename}"`,
      })
      continue
    }

    matches.push({
      item,
      sourceFilename,
      ...repositoryFile,
    })
  }

  console.log(`Repository PDFs: ${trackedFiles.length}`)
  console.log(`Framer CMS records: ${items.length}`)
  console.log(`Matched records: ${matches.length}`)
  console.log(`Unmatched CMS records: ${unmatchedCmsItems.length}`)
  console.log("")

  for (const match of matches) {
    console.log(
      `MATCH: ${match.sourceFilename} → ${match.file} → ${match.isoDate}`
    )
  }

  if (unmatchedCmsItems.length > 0) {
    console.log("\nUNMATCHED CMS RECORDS:")

    for (const unmatched of unmatchedCmsItems) {
      console.log(`- ${unmatched.slug}: ${unmatched.reason}`)
    }
  }

  if (!applyChanges) {
    console.log("\nDRY RUN: No Framer records were changed.")
  } else {
    if (unmatchedCmsItems.length > 0) {
      throw new Error(
        "No records were changed because some CMS records were unmatched."
      )
    }

    for (const match of matches) {
      await match.item.setAttributes({
        fieldData: {
          [lastUpdatedFieldId]: {
            type: "date",
            value: match.isoDate,
          },
        },
      })

      console.log(`UPDATED: ${match.sourceFilename}`)
    }

    console.log(`\nUpdated ${matches.length} Framer CMS records.`)
    console.log("The Framer project was not published.")
  }
