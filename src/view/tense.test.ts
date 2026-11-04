import { expect, test } from "bun:test";
import { inPastTense, inPresentTense } from "./tense";

test("puts a description's first verb in the past tense", () => {
  expect(inPastTense("Run the bun test suite")).toBe("Ran the bun test suite");
  expect(inPastTense("Create a feature branch off main")).toBe("Created a feature branch off main");
  expect(inPastTense("Show working tree status")).toBe("Showed working tree status");
  expect(inPastTense("Fix the build")).toBe("Fixed the build");
  expect(inPastTense("Copy the file")).toBe("Copied the file");
  expect(inPastTense("Deploy the site")).toBe("Deployed the site");
  expect(inPastTense("Read the bun test output file")).toBe("Read the bun test output file");
  expect(inPastTense("Shoot the close droid")).toBe("Shot the close droid");
  expect(inPastTense("Checkout main")).toBe("Checked out main");
  expect(inPastTense("Run tests.")).toBe("Ran tests");
});

test("doubles the last letter where English does", () => {
  expect(inPastTense("Stop the server")).toBe("Stopped the server");
  expect(inPastTense("Log the frames")).toBe("Logged the frames");
  expect(inPastTense("Commit the retry change")).toBe("Committed the retry change");
  expect(inPastTense("Unzip the archive")).toBe("Unzipped the archive");
  expect(inPastTense("Rewrap the two long lines")).toBe("Rewrapped the two long lines");
  expect(inPastTense("Open the pull request")).toBe("Opened the pull request");
  expect(inPastTense("Edit the config")).toBe("Edited the config");
});

test("changes the verbs joined to the first", () => {
  expect(inPastTense("Commit the retry change and show recent log")).toBe("Committed the retry change and showed recent log");
  expect(inPastTense("Merge the PR, delete the branch and update local main")).toBe("Merged the PR, deleted the branch and updated local main");
  expect(inPastTense("Stop the test session, typecheck, and review what changed")).toBe("Stopped the test session, typechecked, and reviewed what changed");
  expect(inPastTense("Wait 5 seconds, then show last five commits")).toBe("Waited 5 seconds, then showed last five commits");
  expect(inPastTense("Pick launcher; add pitch; register it")).toBe("Picked launcher; added pitch; registered it");
  expect(inPastTense("Add tests for remove's report, then run them")).toBe("Added tests for remove's report, then ran them");
});

test("leaves the nouns in a list alone", () => {
  expect(inPastTense("Read the current inputs and focus handling")).toBe("Read the current inputs and focus handling");
  expect(inPastTense("Read the show tool's renderer and find where images live")).toBe("Read the show tool's renderer and found where images live");
  expect(inPastTense("Check the logs and test results")).toBe("Checked the logs and test results");
  expect(inPastTense("Run flyer unit and build tests")).toBe("Ran flyer unit and build tests");
  expect(inPastTense("Rerun the plugin's tests, validation and type check")).toBe("Reran the plugin's tests, validation and type check");
  expect(inPastTense("Read freeze, Picture and Preview types")).toBe("Read freeze, Picture and Preview types");
  expect(inPastTense("Run the repo's check: configure and build")).toBe("Ran the repo's check: configure and build");
});

test("handles verbs with a hyphen, and words that aren't verbs", () => {
  expect(inPastTense("Type-check the mod")).toBe("Type-checked the mod");
  expect(inPastTense("Re-run ship readiness check")).toBe("Re-ran ship readiness check");
  expect(inPastTense("Fast-forward master")).toBe("Fast-forwarded master");
  expect(inPastTense("Read masked seg rendering and fixed-point wall math")).toBe("Read masked seg rendering and fixed-point wall math");
  expect(inPastTense("Real-time preview of the build")).toBeNull();
  expect(inPastTense("README, then the docs")).toBeNull();
  expect(inPastTense("The final check")).toBeNull();
  expect(inPastTense("")).toBeNull();
});

test("doubles the last letter of bootstrap, as of the verbs listed with it", () => {
  expect(inPastTense("Bootstrap the project")).toBe("Bootstrapped the project");
});

test("puts a description in the present tense, joined verbs too", () => {
  expect(inPresentTense("Run the bun test suite")).toBe("Running the bun test suite");
  expect(inPresentTense("Make the build reproducible")).toBe("Making the build reproducible");
  expect(inPresentTense("See what changed")).toBe("Seeing what changed");
  expect(inPresentTense("Free the port")).toBe("Freeing the port");
  expect(inPresentTense("Tie off the loose ends")).toBe("Tying off the loose ends");
  expect(inPresentTense("Fix the build")).toBe("Fixing the build");
  expect(inPresentTense("Copy the file")).toBe("Copying the file");
  expect(inPresentTense("Stop the server and log the frames")).toBe("Stopping the server and logging the frames");
  expect(inPresentTense("Commit the change, then push it")).toBe("Committing the change, then pushing it");
  expect(inPresentTense("Begin the migration")).toBe("Beginning the migration");
  expect(inPresentTense("Edit the config")).toBe("Editing the config");
  expect(inPresentTense("Open the pull request")).toBe("Opening the pull request");
  expect(inPresentTense("Checkout main")).toBe("Checking out main");
  expect(inPresentTense("Rerun the suite")).toBe("Rerunning the suite");
  expect(inPresentTense("Rewrite the tests")).toBe("Rewriting the tests");
  expect(inPresentTense("Type-check the mod")).toBe("Type-checking the mod");
  expect(inPresentTense("Check the logs and test results")).toBe("Checking the logs and test results");
  expect(inPresentTense("README, then the docs")).toBeNull();
});
