// Entry: mqjs -I harness.js -I <model>.js run.js <scenario> [verify]
__verify = scriptArgs.length > 2 && scriptArgs[2] === "verify";
runScenario(scriptArgs[1], __verify);
