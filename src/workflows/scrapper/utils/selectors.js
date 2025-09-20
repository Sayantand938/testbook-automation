// src/workflows/scrapper/utils/selectors.js

/**
 * Centralized configuration for all CSS selectors.
 */
export const selectors = {
  /**
   * Selectors used for browser INTERACTION (clicking, checking state).
   * These are used by the CDP client (Runtime.evaluate).
   */
  scraper: {
    solutionsButton: 'a[href*="#/solutions"]',
    viewSolutionButton: 'button[ng-click="toggleViewSolution()"]',
    nextButton: 'button[ng-click="navBtnPressed(true)"]',
    // Note: While we now use a text-based check for the last question,
    // this selector is kept for potential future use or debugging.
    lastQuestionModal: 'div.bootbox-confirm', 
  },

  /**
   * Selectors used for data EXTRACTION with Cheerio.
   * These are used after getting the page's HTML to parse the content.
   */
  parser: {
    // Selector for the main exam name on the analysis page.
    examName: 'div.sticky-header__title .d-none.d-md-block',

    // The stable parent container for the currently visible question.
    activeQuestionContainer: '#questions',
    
    // The container for the question number (e.g., "Question No. 1").
    questionNumber: '.tp-ques-number',

    // The name of the current test section (e.g., "General Awareness").
    sectionName: 'li.active span.hidden-xs',
    
    // The passage/comprehension text (may not always be present).
    comprehension: '.aei-comprehension div[ng-bind-html^="getComprehension"]',
    
    // The main body of the question itself.
    questionBody: '.que-ans-box > .qns-view-box[ng-bind-html*="getQuestionDesc"]',
    
    // The container for a single option row.
    optionContainer: 'li.option',
    
    // The text content within a single option container.
    optionText: '.qns-view-box',
    
    // The class name used to identify the correct answer's li element.
    correctOptionClass: 'correct-option',
    
    // The container for the detailed solution text.
    solution: 'div[ng-show="isSet(1)"] > .qns-view-box',
  }
};